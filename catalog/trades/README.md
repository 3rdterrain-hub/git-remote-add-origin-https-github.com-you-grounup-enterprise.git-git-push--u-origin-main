# Trade packs

The shipped catalog under `06-Catalog-and-Architecture-Data` covers heavy civil
and nothing else — 188 services, all earthwork, utilities, paving, demolition
and mining. A contractor outside those trades opens the library and finds
nothing for their work.

These packs are the rest, kept in the repository rather than in the external
catalog because they are ours: written here, reviewed here, and versioned with
the code that reads them.

## What a pack promises, and what it does not

Every service in a pack is **structurally complete**: it has a unit its trade
actually bids in, an assembly, the tasks that make it up, and a production rate
so it prices rather than returning zero. That is what makes the library usable
on the first day.

Every production rate in a pack is **an unsourced benchmark**, and the platform
says so at three levels rather than hoping somebody remembers:

- `source_type` is `seed_benchmark`, which the engine already warns about by
  name — *"a starting point, not a company production standard."*
- `approval_state` is `pending`, so it is a draft catalog rate and the engine
  says to approve it or substitute a company actual before the estimate is
  issued.
- `confidence_score` is lower than the sourced heavy-civil rates carry, so the
  confidence engine scores an estimate built on them for what it is.

A rate nobody can source is the same defect as a typed price. The difference
between a defect and an honest starting point is whether the platform tells you
which one you are looking at — and the learning loop is what fixes it: a
company's own measured production replaces these the moment there is any.

## Shape

```json
{
  "trade": "Electrical",
  "code": "EL",
  "tasks": ["Review documents and layout", "Mobilize", "..."],
  "productionTask": "Install",
  "categories": [
    {
      "name": "Branch wiring",
      "services": [
        { "name": "Branch circuit, 12 AWG in EMT", "unit": "LF",
          "units": ["LF", "EA"], "rate": 45 }
      ]
    }
  ]
}
```

`rate` is production per hour in the service's default unit. `productionTask`
names which task in the list the rate hangs off — the one that actually governs
how long the work takes.
