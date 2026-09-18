-- =============================================================================
-- 0230 — The tenant key leads every index
--
-- 0229's three tables each carry `company_id` and each indexed something else
-- first: the form, the question, the lead. `tests/db/schema-invariants` failed
-- the build on all three, which is the invariant doing its job.
--
-- The rule is not decoration. Every read of these tables is filtered by RLS on
-- `company_id` before anything else is considered, so an index that does not
-- lead with it cannot serve that filter — Postgres would scan and then discard.
-- On a platform where one company's rows sit in the same table as every other
-- company's, the tenant key is the most selective column there is, and it has
-- to be the first one.
--
-- The original indexes stay. They serve the ordered read inside one form, which
-- is a different question from "whose rows are these".
--
-- ENTITY.
-- =============================================================================

create index if not exists lead_form_questions_company_idx
  on lead_form_questions(company_id, form_id, sort_order);

create index if not exists lead_form_choices_company_idx
  on lead_form_choices(company_id, question_id, sort_order);

create index if not exists lead_answers_company_idx
  on lead_answers(company_id, lead_id, sort_order);
