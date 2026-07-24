# CROC case brief

## Must-have

1. Assign one or more categories to every user request.
2. Discover stable use-case groups inside those categories.
3. Generate an interpretable summary and representative examples per group.
4. Present the result as a report or dashboard for executives.

## What the CTO needs to decide

- Which agents and integrations should be developed next?
- Which workflows have the highest automation potential?
- Where do users repeat, reformulate or fail?
- Which departments receive measurable value?
- Where is training more appropriate than engineering?

## Provided data

The source CSV contains 31 one-column descriptions of desired corporate
scenarios. It is a seed list, not a log dataset. Several rows contain quoted
multiline text.

The repository therefore needs a reproducible generator that creates varied
user formulations, dates, departments, outcomes and hidden expected labels.

## Recommended taxonomy

Classify on two independent axes:

- action: retrieve, summarize, analyze, write, create, update, export, schedule,
  monitor, notify;
- domain: email, CRM/sales, project systems, HR, calendar/meetings, knowledge
  base, spreadsheets/analytics, public sources.

A concrete scenario is a stable pattern below these two axes.
