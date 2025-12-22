# Documentation

This folder contains technical documentation for the Familjen app.

## Quick Reference

| Document | Purpose |
|----------|---------|
| [api-integrations.md](./api-integrations.md) | **Start here** - Complete API reference for all external integrations (Spond, iSkole, Kidplan, MyKid) |
| [supabase-email-templates.md](./supabase-email-templates.md) | Supabase Auth email templates (Norwegian) |

## Research Notes

These files contain historical research notes, HAR analysis, and detailed findings from reverse engineering each service. Useful for debugging or extending integrations.

| Document | Service |
|----------|---------|
| [iskole-integration-research.md](./iskole-integration-research.md) | iSkole school portal (Oracle ADF) |
| [kidplan-integration-research.md](./kidplan-integration-research.md) | Kidplan kindergarten (ASP.NET) |
| [mykid-integration-research.md](./mykid-integration-research.md) | MyKid kindergarten (CSRF-heavy) |

## Other Documentation

- **[../CLAUDE.md](../CLAUDE.md)** - Main development guide (start here for codebase overview)
- **[../README.md](../README.md)** - Project README with setup instructions
- **[../src/lib/integrations/spond/README.md](../src/lib/integrations/spond/README.md)** - Spond client notes

## Key Features Documented

- **Four External Integrations**: Spond, iSkole, Kidplan, MyKid
- **AI Document Extraction**: Vision model for PDFs and web pages
- **Manual URL Sources**: Users can add school calendars/schedules directly
- **Suggestion Workflow**: AI extracts events → user reviews → creates tasks/events

## Document Status

| Document | Last Updated | Status |
|----------|--------------|--------|
| api-integrations.md | Dec 2024 | Current - includes document extraction system |
| iskole-integration-research.md | Dec 2024 | Current |
| kidplan-integration-research.md | Dec 2024 | Historical |
| mykid-integration-research.md | Dec 2024 | Historical |
| supabase-email-templates.md | Dec 2024 | Current |

## Implementation Status

See [api-integrations.md](./api-integrations.md#implementation-status) for the full feature matrix showing what's implemented vs pending for each integration.
