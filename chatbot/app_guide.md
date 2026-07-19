# Agenvo App Guide

Agenvo is an agency income tracker. Data is saved automatically per signed-in
account. Depending on setup, the workspace runs in **service agency** mode
(clients + team members + sales) or **solo/brand** mode (brands + expense
categories + entries). Tab names below use the default terms; the user can
rename terms like "Clients", "Team Members", and "Sales" in Settings, so their
sidebar labels may differ.

## Navigation (sidebar)

The sidebar is the floating panel on the left. Click an item to switch tabs.
It can be collapsed with the collapse control at its bottom.

### Service agency mode tabs
- **Dashboard** — overview of revenue, agency earnings, team pay; charts with
  daily/weekly/monthly granularity; per-client and per-team-member breakdown
  cards; date filter.
- **Add Sales** — log sales for a chosen date. Pick the client, type amounts
  next to each team member, then save. Supports logging several team members
  at once, and a smart-paste tool that scans pasted text for names and amounts.
- **Clients** — add, edit, and delete clients. Per client: name, color,
  currency, agency fee share, and team pay share; extra payout roles can be
  configured while editing a client. Team members are added here under the
  client they work for.
- **Invoices** — build and view invoices from logged sales; invoices can be
  shared or printed.
- **History** — every logged sale in a table; edit or delete individual
  records; export data as CSV; undo the last delete.

### Solo / brand mode tabs
- **Dashboard** — revenue, spend, and profit overview with charts.
- **Add Entry** — log an entry for a brand and date: the brand payment (flat,
  hourly, or % of revenue) and expenses per category, with manual overrides.
- **Brands** — add/edit brands, each with a color and payment structure;
  retainer brands support a quick-log.
- **Categories** — expense categories with a color and a cost rule (percent or
  flat) used to pre-calculate spend in Add Entry.
- **Invoices** and **History** — same as service mode.

## Common actions
- **Switch theme** — the light/dark toggle sits in the top header bar. Light
  mode is "Daylight", dark mode is "Midnight".
- **Account menu** — top-right avatar: sign out, delete account, reset data.
- **Settings** — accessible from the header; covers business name and logo,
  base currency plus extra currencies (live exchange rates, editable by hand),
  and renaming terms (what you call clients, team members, sales).
- **Onboarding** — first sign-in runs a short setup wizard: agency type, name,
  currency, and default commission splits.

## What the assistant can answer
- Navigation questions: where to find a screen or action (from this guide).
- Analytics questions from the user's own data: top clients by revenue,
  best/top team members, best day, and overall revenue summary (total revenue,
  agency earnings, team pay, counts).

AgenMate (the assistant) cannot: edit data, log sales, create invoices, or answer
questions unrelated to Agenvo.
