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
  TEXT_BATCH, SCAN_BATCH, BUDGET_MS, nextRun, shouldHandBack, maxTokensFor,
  SCAN_EFFORT, TEXT_EFFORT,
} from '../_shared/plan-analysis.ts';

const AGENT_ID = 'AGT-DOC';
const PROMPT_VERSION = 'v1';
/** Model the platform routes plan reading to. Overridable per company later. */
const MODEL = 'claude-opus-5';
/**
 * How long an uploaded set stays with the reader: a day.
 *
 * Long enough that a job interrupted and picked up again tomorrow still refers
 * to the same file, short enough that a set nobody came back for does not sit
 * there. The file is deleted outright when the job completes; this is only the
 * backstop for a job that never does.
 */
const FILE_TTL_SECONDS = 86_400;

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

    /* Trimmed for the same reason the health probe trims it: a trailing
       newline on a pasted secret is invisible and fails like a wrong key. */
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
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
    let scan: Blob | null = null;

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
      /*
       * Held as a Blob and handed straight to the upload.
       *
       * What used to happen here was base64: the bytes became a binary string
       * and then a base64 string a third larger again, and the SDK then
       * serialized that into the request body — three copies of a twenty-five
       * megabyte set alive at once, on a worker with two hundred and fifty-six
       * megabytes and a long stream held open. That is what killed the reader
       * on the first real plan set it was given, and reading fewer pages per
       * call would not have helped, because every call did all of it again.
       */
      scan = file.data;
    }

    /*
     * Close out anything this company left stranded before opening anything new.
     *
     * A worker killed at the platform's resource limit never runs its own error
     * handler, so the job it had open stays at its last stage forever and the
     * screen shows a spinner for a process that stopped existing minutes ago.
     * Swept here rather than on a schedule: this is the moment somebody is
     * looking at this company's jobs, so it is the moment a stale one matters.
     */
    await admin.rpc('abandon_stranded_ingestion_jobs', {
      p_company: companyId, p_minutes: 10,
    });

    /*
     * Carry on with the job already open for this version, or open one.
     *
     * A reading happens in pieces now, so a second request for the same set is
     * usually somebody continuing rather than somebody starting again. Opening
     * a second job would bill the model twice for the same pages and leave two
     * rows arguing about how far the set had got.
     */
    const { data: existing } = await admin
      .from('ingestion_jobs')
      .select('id, pages_processed, provider_file_id, input_tokens, output_tokens, attempts')
      .eq('document_version_id', documentVersionId)
      .not('stage', 'in', '(complete,failed)')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let pagesDone = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let providerFileId: string | null = null;

    if (existing) {
      jobId = existing.id;
      pagesDone = Number(existing.pages_processed ?? 0);
      providerFileId = existing.provider_file_id ?? null;
      inputTokens = Number(existing.input_tokens ?? 0);
      outputTokens = Number(existing.output_tokens ?? 0);
      /*
       * A page that has defeated five workers is a page this cannot read.
       *
       * Without this the loop is perfect and useless: the worker dies on the
       * same sheet, the counter never moves, the next pass starts on the same
       * sheet, forever. Five attempts is what `attempts` has allowed since
       * 0019, and the refusal names the page, because "it failed" sends
       * somebody looking through fourteen drawings for the one that did it.
       */
      const attempts = Number(existing.attempts ?? 1) + 1;
      if (attempts > 5) {
        await admin.from('ingestion_jobs').update({
          stage: 'failed',
          error_message:
            `Page ${pagesDone + 1} could not be read inside the time a worker has, `
            + `after five tries. The ${pagesDone} pages before it were read and what `
            + 'they contained has been kept. That sheet needs splitting or reading by hand.',
          duration_ms: Date.now() - started,
        }).eq('id', jobId);
        return fail(
          'page_too_dense',
          `Page ${pagesDone + 1} could not be read inside the time available, after five tries. `
            + `The ${pagesDone} pages before it were read and kept.`,
          422, origin,
        );
      }
      await admin.from('ingestion_jobs').update({
        attempts,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
    } else {
      /*
       * A new job, but not necessarily from the first page.
       *
       * Findings are written batch by batch and the counter only moves after
       * they land, so the furthest any earlier job for this version reached is
       * a point whose findings are already in the table. Starting a new job at
       * zero would read those pages a second time and file everything on them
       * twice — and the reason a new job exists at all is usually that the last
       * one was swept as stranded, which is a silence, not a reason to forget
       * what it had already done.
       */
      const { data: furthest } = await admin
        .from('ingestion_jobs')
        .select('pages_processed')
        .eq('document_version_id', documentVersionId)
        .order('pages_processed', { ascending: false })
        .limit(1)
        .maybeSingle();
      pagesDone = Math.min(Number(furthest?.pages_processed ?? 0), sheets.length);

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
          pages_processed: pagesDone,
          progress: Math.min(pagesDone / Math.max(sheets.length, 1), 1),
          started_at: new Date().toISOString(),
          requested_by: caller.userId,
          attempts: 1,
        })
        .select('id')
        .single();
      if (jobError) throw jobError;
      jobId = job.id;
    }

    const anthropic = new Anthropic({ apiKey });

    /*
     * The set goes to the reader once and is referred to by its id afterwards.
     *
     * This is the whole fix for the worker that was being killed: a request now
     * carries an identifier rather than the file, so the second batch costs the
     * same to send as the first and neither costs anything to hold.
     */
    if (scan && !providerFileId) {
      const uploaded = await anthropic.files.upload({
        file: new File([scan], version.file_name ?? 'plans.pdf', { type: 'application/pdf' }),
        expires_in_seconds: FILE_TTL_SECONDS,
      });
      providerFileId = uploaded.id;
      await admin.from('ingestion_jobs')
        .update({ provider_file_id: providerFileId, updated_at: new Date().toISOString() })
        .eq('id', jobId);
    }
    const allAccepted: ReturnType<typeof toFindingRow>[] = [];
    const allRejected: { finding: unknown; reason: string }[] = [];
    let runsDone = 0;
    let longestRunMs = 0;
    let handedBack = false;

    /*
     * Both paths are batched now, for two different reasons.
     *
     * Text is batched because the batches are independent and a long set would
     * otherwise be one enormous request. A scan is batched because the answer
     * is long, not the question: the file is already uploaded, so what takes
     * the minutes is a model reading four drawings and writing down what it
     * found. Four at a time keeps one batch inside the life of a worker.
     */
    const step = scan ? SCAN_BATCH : TEXT_BATCH;

    for (;;) {
      const run = nextRun(pagesDone, sheets.length, step);
      if (!run) break;

      /*
       * Asked before the batch rather than after. A budget checked afterwards
       * is a budget that has already been spent, and being stopped by the
       * platform is exactly the failure this is here to avoid.
       *
       * The condition counts batches finished, not findings found. It counted
       * findings first, and the first real set went straight through it: pages
       * one and two of a plan set are a cover sheet and an index, they produced
       * nothing, so "have I done any work yet" answered no after ninety-nine
       * seconds of work and the worker walked into a second batch it had no
       * time for. A batch that finds nothing is still a batch that took the
       * time.
       */
      /*
       * On a scan, one page and then hand back — always, without arithmetic.
       *
       * The budget below estimates the next page from the last one, and on a
       * scanned set that estimate is worthless: page three came back in
       * twenty-two seconds and page five could not be read in a hundred and
       * fifty. A short page therefore *encouraged* the worker into the next one
       * and it died there, losing the pass. Text pages are uniform enough for
       * the estimate to mean something, so it still applies to them.
       */
      if (runsDone > 0
          && (scan || shouldHandBack(Date.now() - started, longestRunMs, BUDGET_MS))) {
        handedBack = true;
        break;
      }

      const batch = sheets.slice(run.from, run.to);
      const runStarted = Date.now();

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
        max_tokens: maxTokensFor(batch.length),
        thinking: { type: 'adaptive' },
        output_config: {
          effort: scan ? SCAN_EFFORT : TEXT_EFFORT,
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
            content: providerFileId
              ? [
                {
                  type: 'document' as const,
                  source: {
                    type: 'file' as const,
                    file_id: providerFileId,
                  },
                  /*
                   * The set is the same on every batch of the same job, so
                   * caching it turns "read these drawings again" into a cache
                   * read rather than a second look at every page.
                   */
                  cache_control: { type: 'ephemeral' as const },
                },
                {
                  type: 'text' as const,
                  text:
                    `These are the drawings from "${version.file_name}" — `
                    + `${version.page_count ?? sheets.length} pages, scanned, with no text layer, `
                    + 'so read them from the images.\n\n'
                    + `Report only on pages ${batch[0]?.page_number}–${batch[batch.length - 1]?.page_number}. `
                    + 'The rest of the set is there for context — a detail called out on one sheet '
                    + 'and drawn on another is worth following — but a finding whose subject is '
                    + 'outside those pages belongs to a different pass and will be recorded twice.\n\n'
                    + 'The sheets in this pass, in page order:\n'
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
      longestRunMs = Math.max(longestRunMs, Date.now() - runStarted);
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
        /*
         * A declined batch is still a batch that has been put to the model, and
         * the job has to move past it. Leaving `pagesDone` where it was would
         * put the same pages up again on the next call, forever.
         */
        pagesDone = run.to;
        runsDone += 1;
        await admin.from('ingestion_jobs').update({
          pages_processed: pagesDone,
          progress: Math.min(pagesDone / sheets.length, 1),
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        continue;
      }

      /*
       * A truncated answer is not an answer, and these pages have not been read.
       *
       * Caught before anything is parsed and, above all, before the page
       * counter moves: a batch cut off at its ceiling used to be recorded as
       * "not valid JSON", the pages were marked read, and the set moved on
       * having silently skipped them. A reader that skips pages and reports
       * success is worse than one that stops.
       */
      if (message.stop_reason === 'max_tokens') {
        allRejected.push({
          finding: null,
          reason: `Pages ${batch[0]?.page_number}–${batch[batch.length - 1]?.page_number} `
            + 'ran past the answer limit and were cut off. They have not been read, '
            + 'and have been left for another pass rather than counted.',
        });
        handedBack = true;
        break;
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
        pagesDone = run.to;
        runsDone += 1;
        await admin.from('ingestion_jobs').update({
          pages_processed: pagesDone,
          progress: Math.min(pagesDone / sheets.length, 1),
          updated_at: new Date().toISOString(),
        }).eq('id', jobId);
        continue;
      }

      const { accepted, rejected } = validateFindings(parsed);
      allRejected.push(...rejected);
      const rows = accepted.map((f) =>
        toFindingRow(f, {
          companyId: String(companyId),
          agentId: AGENT_ID,
          documentId: version.document_id,
          documentVersionId: String(documentVersionId),
          model: MODEL,
          promptVersion: PROMPT_VERSION,
        }));
      allAccepted.push(...rows);

      /*
       * Written now, not at the end.
       *
       * They used to be collected through every batch and inserted once the
       * whole set was done, which meant a reading cut off at page twelve of
       * fourteen threw away everything it had found. A reading that happens in
       * pieces has to keep each piece, or being interrupted costs as much as
       * never having started.
       *
       * Written with the service role: the rows are attributed to the agent,
       * and the acceptance trigger still requires a human to act on them.
       */
      if (rows.length > 0) {
        const { error: insertError } = await admin.from('ai_findings').insert(rows);
        if (insertError) throw insertError;
      }

      /*
       * And only now is the page counter moved. If the insert above threw, the
       * batch is read again next time rather than being silently skipped —
       * paying for the same pages twice is recoverable, losing them is not.
       */
      pagesDone = run.to;
      runsDone += 1;
      const advanced = await admin.from('ingestion_jobs').update({
        pages_processed: pagesDone,
        progress: Math.min(pagesDone / sheets.length, 1),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        /*
         * Back to one, because this attempt got somewhere.
         *
         * `attempts` has to count attempts that achieved nothing, not passes.
         * A fourteen-page scan is fourteen passes by design, and a counter that
         * ticked on each of them would refuse the set at page five for being
         * too dense to read — while it was being read perfectly well.
         */
        attempts: 1,
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);
      /*
       * Checked, because this is the statement that makes the work permanent.
       * The findings are already in the table; if the counter does not move
       * with them the pages are read again on the next pass and everything on
       * them is filed twice. A silent failure here is indistinguishable from a
       * worker that died, which is exactly how an afternoon gets spent.
       */
      if (advanced.error) throw advanced.error;
    }

    const durationMs = Date.now() - started;

    /*
     * Handed back rather than finished: there are pages left and the worker is
     * near the end of its life. The job stays open at the page it reached, the
     * findings from this run are already written, and the caller asks again.
     */
    if (handedBack) {
      await admin.from('ingestion_jobs').update({
        pages_processed: pagesDone,
        progress: Math.min(pagesDone / sheets.length, 1),
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_estimate: estimateCost(MODEL, inputTokens, outputTokens),
        updated_at: new Date().toISOString(),
      }).eq('id', jobId);

      return json({
        jobId,
        done: false,
        pagesAnalyzed: pagesDone,
        pagesTotal: sheets.length,
        findingsCreated: allAccepted.length,
        findingsRejected: allRejected.length,
        rejectionReasons: allRejected.map((r) => r.reason).slice(0, 20),
        usage: { inputTokens, outputTokens, costEstimate: estimateCost(MODEL, inputTokens, outputTokens) },
        durationMs,
        note: `Read ${pagesDone} of ${sheets.length} pages. Ask again to carry on from there.`,
      }, 200, origin);
    }

    /*
     * The count of findings comes from the table, not from this run's tally.
     * A job finished across three invocations found things in all three, and
     * only the rows know the total.
     */
    const { count: foundAltogether } = await admin
      .from('ai_findings')
      .select('id', { count: 'exact', head: true })
      .eq('document_version_id', documentVersionId);

    await admin.from('ingestion_jobs').update({
      stage: 'complete',
      progress: 1,
      pages_processed: sheets.length,
      findings_created: foundAltogether ?? allAccepted.length,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_estimate: estimateCost(MODEL, inputTokens, outputTokens),
      completed_at: new Date().toISOString(),
      duration_ms: durationMs,
    }).eq('id', jobId);

    /*
     * The uploaded set has done its work. Left behind it would sit with the
     * reader for a day for no reason, and a company's drawings should not
     * outlive the reading they were uploaded for.
     */
    if (providerFileId) {
      await anthropic.files.delete(providerFileId).catch(() => undefined);
      await admin.from('ingestion_jobs')
        .update({ provider_file_id: null }).eq('id', jobId);
    }

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
        read_by: scan ? 'image' : 'text_layer',
        input_tokens: inputTokens, output_tokens: outputTokens,
        findings: allAccepted.length, rejected: allRejected.length,
      },
    });

    return json({
      jobId,
      done: true,
      pagesAnalyzed: sheets.length,
      pagesTotal: sheets.length,
      findingsCreated: foundAltogether ?? allAccepted.length,
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
