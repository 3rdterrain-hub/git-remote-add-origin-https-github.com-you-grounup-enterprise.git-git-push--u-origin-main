/**
 * POST /functions/v1/ai-analyze-document
 *
 * Reads an uploaded plan set or specification with Claude and writes cited
 * findings for human review.
 *
 * The governance is structural, not advisory:
 *  - Findings are written with state 'proposed'. The database independently
 *    refuses an AI finding that arrives accepted, and refuses a factual finding
 *    with no citation.
 *  - The model is told it does not compute cost, price, production or duration.
 *    Those come from the deterministic engine, which is the whole point.
 *  - Every finding records the model and prompt version that produced it, so a
 *    bad quantity can be traced to the run that created it.
 *
 * Deploy: supabase functions deploy ai-analyze-document
 * Secrets: ANTHROPIC_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk';
import { getCaller, requirePermission, isUuid, adminClient } from '../_shared/auth.ts';
import { fail, json, preflight } from '../_shared/http.ts';
import {
  FINDINGS_SCHEMA, SYSTEM_PROMPT, validateFindings, toFindingRow, estimateCost,
} from '../_shared/plan-analysis.ts';

const AGENT_ID = 'AGT-DOC';
const PROMPT_VERSION = 'v1';
/** Model the platform routes plan reading to. Overridable per company later. */
const MODEL = 'claude-opus-5';
/** Pages sent in one request. Beyond this the job is split into batches. */
const PAGE_BATCH = 20;

/**
 * Base64 for a PDF that goes to the model as a document.
 *
 * Chunked rather than `String.fromCharCode(...bytes)`, which overflows the call
 * stack somewhere around a megabyte — and the files this reads are tens of
 * megabytes. `btoa` emits no newlines, which the API requires.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return fail('method_not_allowed', 'Use POST.', 405, origin);

  const started = Date.now();
  let jobId: string | null = null;
  const admin = adminClient();

  try {
    const caller = await getCaller(req);
    if (!caller) return fail('unauthenticated', 'Sign in to analyze a document.', 401, origin);

    const { companyId, documentVersionId } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (!isUuid(companyId)) return fail('bad_request', 'A valid companyId is required.', 400, origin);
    if (!isUuid(documentVersionId)) {
      return fail('bad_request', 'A valid documentVersionId is required.', 400, origin);
    }

    const permitted = await requirePermission(caller, companyId, 'documents.write');
    if (!permitted.ok) return fail('forbidden', permitted.reason, 403, origin);

    // Commercial entitlement is a separate question from authorization.
    const { data: entitled } = await caller.client.rpc('has_entitlement', {
      p_company: companyId, p_feature: 'ai_plan_review',
    });
    if (entitled !== true) {
      return fail('not_entitled', 'AI plan review is not included in this plan.', 402, origin);
    }

    /*
     * Entitlement says the feature is included. The allowance says how much of
     * it is left this period.
     *
     * Every run has always written a `usage_events` row with metric
     * `ai.request`, and `app.current_usage` has always aggregated it over the
     * paid period. Nothing compared the two, so the AI credit allowance
     * published on the plan version bounded nothing at all.
     */
    const { data: withinAllowance } = await caller.client.rpc('ai_request_allowed', {
      p_company: companyId,
    });
    if (withinAllowance === false) {
      return fail(
        'allowance_exhausted',
        'This period\'s AI request allowance is used up. It resets at the start of the next billing period, or upgrade for a larger allowance.',
        402, origin);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return fail('not_configured', 'AI plan review is not configured on this deployment.', 503, origin);
    }

    // Read the document through the caller's client so RLS confirms access.
    const { data: version, error: versionError } = await caller.client
      .from('document_versions')
      .select('id, document_id, file_name, page_count, storage_bucket, storage_path, processing_state')
      .eq('id', documentVersionId)
      .single();
    if (versionError || !version) {
      return fail('not_found', 'That document version was not found.', 404, origin);
    }

    const { data: sheets } = await caller.client
      .from('document_sheets')
      .select('id, page_number, sheet_number, sheet_title, discipline, extracted_text')
      .eq('document_version_id', documentVersionId)
      .order('page_number');

    if (!sheets || sheets.length === 0) {
      return fail(
        'not_extracted',
        'This document has no extracted sheets yet. Run text extraction before analysis.',
        409, origin,
      );
    }

    /*
     * A set with no text layer is read by eye instead.
     *
     * `document_sheets.extracted_text` is filled at upload from the PDF's own
     * text (migration 0172). A set that still has none is a scan — and a large
     * share of real plan sets are scans, because that is what comes back from a
     * plan room or a county. Refusing those, which is what this function did,
     * turned away exactly the drawings that most need reading.
     *
     * So the text layer is preferred where it exists — it is exact, cheap and
     * carries no risk of a misread character — and where there is none the
     * pages themselves go to the model. That is a real difference in kind and
     * the job record says which path ran, because a quantity read off a scan
     * deserves a closer look than one lifted from embedded text.
     */
    const hasTextLayer = sheets.some((s) => (s.extracted_text ?? '').trim() !== '');
    let pdf: string | null = null;

    if (!hasTextLayer) {
      if (!version.storage_bucket || !version.storage_path) {
        return fail(
          'not_extracted',
          'This set has no text layer and no stored file to read instead.',
          409, origin,
        );
      }
      /*
       * The API takes a whole document, not a page range, so the size limits
       * are checked before spending anything: 32 MB a request and 600 pages.
       * A set past either is refused with the number, which is actionable —
       * split it — where "too large" is not.
       */
      if ((version.page_count ?? sheets.length) > 600) {
        return fail(
          'too_large',
          `This set has ${version.page_count ?? sheets.length} pages and has no text layer, `
            + 'so every page has to be read as an image. The reader takes 600 pages at a time — '
            + 'split the set and upload it in parts.',
          413, origin,
        );
      }

      const file = await admin.storage.from(version.storage_bucket)
        .download(version.storage_path);
      if (file.error || !file.data) {
        return fail('not_found', 'The stored file could not be read.', 404, origin);
      }
      const bytes = new Uint8Array(await file.data.arrayBuffer());
      if (bytes.byteLength > 30 * 1024 * 1024) {
        return fail(
          'too_large',
          `That file is ${Math.round(bytes.byteLength / 1024 / 1024)} MB and has no text layer, `
            + 'so it has to be read as images. A request carries 32 MB — split the set.',
          413, origin,
        );
      }
      pdf = toBase64(bytes);
    }

    // Claim the job so concurrent requests do not both bill the model.
    const { data: job, error: jobError } = await admin
      .from('ingestion_jobs')
      .insert({
        company_id: companyId,
        document_id: version.document_id,
        document_version_id: documentVersionId,
        stage: 'extracting',
        agent_id: AGENT_ID,
        model: MODEL,
        prompt_version: PROMPT_VERSION,
        pages_total: sheets.length,
        started_at: new Date().toISOString(),
        requested_by: caller.userId,
        attempts: 1,
      })
      .select('id')
      .single();
    if (jobError) throw jobError;
    jobId = job.id;

    const anthropic = new Anthropic({ apiKey });
    const allAccepted: ReturnType<typeof toFindingRow>[] = [];
    const allRejected: { finding: unknown; reason: string }[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    /*
     * Text is batched by page because the batches are independent and a long
     * set would otherwise be one enormous request. A scan is not: the API takes
     * a document, not a page range, so the file goes in whole and there is
     * exactly one pass.
     */
    const step = pdf ? sheets.length : PAGE_BATCH;

    for (let i = 0; i < sheets.length; i += step) {
      const batch = sheets.slice(i, i + step);

      const document = batch
        .map((s) =>
          [
            `--- SHEET ${s.sheet_number ?? `page ${s.page_number}`}` +
              (s.sheet_title ? ` — ${s.sheet_title}` : '') +
              (s.discipline ? ` (${s.discipline})` : '') +
              ` [page ${s.page_number}] ---`,
            s.extracted_text ?? '(no text extracted from this sheet)',
          ].join('\n'),
        )
        .join('\n\n');

      /*
       * Streaming with a large max_tokens: a full plan set produces a long
       * findings list, and a non-streaming request at this size risks an HTTP
       * timeout rather than a useful answer.
       */
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: 32_000,
        thinking: { type: 'adaptive' },
        output_config: {
          effort: 'high',
          format: FINDINGS_SCHEMA,
        },
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            // The system prompt is identical on every batch and every document,
            // so caching it turns a large repeated cost into a small one.
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            /*
             * The document block goes before the text, which is what the API
             * asks for and what reads best: the drawings, then the question.
             *
             * On the scanned path the sheet list still goes with it, because
             * `identify_sheet` knows which page is C-101 and the model should
             * cite the sheet a person would name rather than "page 4".
             */
            content: pdf
              ? [
                {
                  type: 'document' as const,
                  source: {
                    type: 'base64' as const,
                    media_type: 'application/pdf' as const,
                    data: pdf,
                  },
                },
                {
                  type: 'text' as const,
                  text:
                    `These are the drawings from "${version.file_name}" — `
                    + `${version.page_count ?? sheets.length} pages, scanned, with no text layer, `
                    + 'so read them from the images.\n\n'
                    + 'The sheets, in page order:\n'
                    + batch.map((sh) =>
                      `  page ${sh.page_number}: ${sh.sheet_number ?? 'unnumbered'}`
                      + (sh.sheet_title ? ` — ${sh.sheet_title}` : '')
                      + (sh.discipline ? ` (${sh.discipline})` : '')).join('\n')
                    + '\n\nCite the sheet number where you can see one, not the page number. '
                    + 'Where a number or a note is not legible, say so rather than guessing at it — '
                    + 'a quantity read wrongly off a scan is worse than one nobody read.',
                },
              ]
              : `Analyze the following construction documents from "${version.file_name}", `
                + `pages ${batch[0]?.page_number}–${batch[batch.length - 1]?.page_number} of ${version.page_count ?? sheets.length}.\n\n`
                + document,
          },
        ],
      });

      const message = await stream.finalMessage();
      inputTokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0);
      outputTokens += message.usage.output_tokens;

      // A safety decline is a legitimate outcome, not a crash. Record it and
      // carry on with the remaining batches.
      if (message.stop_reason === 'refusal') {
        allRejected.push({
          finding: null,
          reason: `The model declined pages ${batch[0]?.page_number}–${batch[batch.length - 1]?.page_number}` +
            (message.stop_details?.category ? ` (${message.stop_details.category})` : '') + '.',
        });
        continue;
      }

      const text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        allRejected.push({ finding: text.slice(0, 400), reason: 'Response was not valid JSON.' });
        continue;
      }

      const { accepted, rejected } = validateFindings(parsed);
      allRejected.push(...rejected);
      for (const f of accepted) {
        allAccepted.push(
          toFindingRow(f, {
            companyId: String(companyId),
            agentId: AGENT_ID,
            documentId: version.document_id,
            documentVersionId: String(documentVersionId),
            model: MODEL,
            promptVersion: PROMPT_VERSION,
          }),
        );
      }

      await admin.from('ingestion_jobs').update({
        pages_processed: Math.min(i + batch.length, sheets.length),
        progress: Math.min((i + batch.length) / sheets.length, 1),
      }).eq('id', jobId);
    }

    // Write findings with the service role: the rows are attributed to the
    // agent, and the acceptance trigger still requires a human to act on them.
    if (allAccepted.length > 0) {
      const { error: insertError } = await admin.from('ai_findings').insert(allAccepted);
      if (insertError) throw insertError;
    }

    const durationMs = Date.now() - started;
    await admin.from('ingestion_jobs').update({
      stage: 'complete',
      progress: 1,
      pages_processed: sheets.length,
      findings_created: allAccepted.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_estimate: estimateCost(MODEL, inputTokens, outputTokens),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).eq('id', jobId);

    await admin.from('usage_events').insert({
      company_id: companyId,
      user_id: caller.userId,
      metric: 'ai.request',
      quantity: 1,
      metadata: {
        agent: AGENT_ID, model: MODEL, pages: sheets.length,
        /*
         * Which way the set was read. A finding lifted from embedded text and
         * one read off a scanned image are not the same evidence, and the
         * person reviewing them should be able to tell without guessing.
         */
        read_by: pdf ? 'image' : 'text_layer',
        input_tokens: inputTokens, output_tokens: outputTokens,
        findings: allAccepted.length, rejected: allRejected.length,
      },
    });

    return json({
      jobId,
      pagesAnalyzed: sheets.length,
      findingsCreated: allAccepted.length,
      findingsRejected: allRejected.length,
      // Surfaced rather than swallowed: a finding the validator threw out is
      // information about the model's behavior, not noise.
      rejectionReasons: allRejected.map((r) => r.reason).slice(0, 20),
      usage: { inputTokens, outputTokens, costEstimate: estimateCost(MODEL, inputTokens, outputTokens) },
      durationMs,
      note: 'Findings are proposed. Nothing enters an estimate until a permitted human accepts it.',
    }, 200, origin);
  } catch (err) {
    if (jobId) {
      await admin.from('ingestion_jobs').update({
        stage: 'failed',
        error_message: String(err).slice(0, 1000),
        duration_ms: Date.now() - started,
      }).eq('id', jobId);
    }
    return fail('analysis_failed', 'The document could not be analyzed.', 500, origin, err);
  }
});
