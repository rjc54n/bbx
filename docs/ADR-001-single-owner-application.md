# ADR 001: Single-owner application

**Status:** accepted
**Decision date:** 25 July 2026

## Context

BBX is a personal, specialist application for one cellar owner. The planned
features include BBR holdings, CellarTracker history, favourites, wishlists,
strategies and agent-assisted analysis. That information is personal even
though the underlying BBX catalogue is assembled from public market sources.

Supporting separate users and cellars would require tenant-scoped rows,
registration, invitations, account recovery, sharing rules and tenant
isolation tests. None of those capabilities serves the current product.

Authentication is still required. A single-owner decision means one permitted
identity, not an anonymous application.

## Decision

BBX is a **single-owner, single-cellar application**.

- One Supabase Auth user is the application owner.
- New user registration and anonymous sign-in are disabled after the owner
  account is provisioned.
- A one-row owner allowlist stores the permitted, stable `auth.users.id`.
- The production owner ID is environment-specific configuration. It is
  provisioned after the Auth user exists and is not hard-coded in a migration
  or committed file.
- Personal domain tables do not repeat an `owner_id` or `tenant_id` column.
- Audit records retain the acting user where it matters, for example
  `uploaded_by`, `accepted_by` and `created_by`.
- Separate cellars, invitations, organisations and data sharing are not
  supported.
- Multiple devices and browser sessions use the same owner identity.
- Automated jobs use server-side credentials and write their actor/source into
  the audit record. They do not become application users.

Adding independently owned cellars later will require an explicit migration
that introduces ownership columns and backfills the existing cellar to its
owner. We accept that cost rather than carrying unused tenancy throughout the
first implementation.

## Security boundary

Supabase Auth and PostgreSQL Row Level Security are the authority for personal
data. Vercel route protection may provide another barrier, but it does not
replace database or Storage policies.

- The Next.js application uses server-validated, cookie-backed Supabase
  sessions before exposing any personal page or upload endpoint.
- Personal tables enable RLS and grant no access to `anon`.
- Policies admit only the user in the owner allowlist.
- Source files use a private Supabase Storage bucket with equivalent owner-only
  policies.
- The Supabase service-role credential is never sent to browser code.
- A server route that uses elevated credentials must first validate the
  session and owner allowlist. Prefer an authenticated RPC and ordinary RLS
  where it can perform the operation safely.
- Personal data is never added to an existing anonymously readable catalogue
  view.
- New personal-data views use `security_invoker = true`, or an RPC with an
  explicit owner check. Ordinary security-definer views must not bypass the
  personal tables' RLS policies.

The public catalogue views may remain anonymously readable because they contain
market data rather than cellar data. Making the catalogue private is a separate
product and operating-cost decision. It is not required to protect the cellar.

## Authentication operation

Provision the owner account before disabling sign-up. Production Auth settings
must then:

- disable new user sign-up;
- keep anonymous sign-in disabled;
- require verified ownership of the configured email identity;
- enable multi-factor authentication for the owner account; and
- allow only the production and approved local callback URLs.

Local `supabase/config.toml` must reflect the intended sign-up policy once the
local owner fixture and authentication tests exist. Do not push production
Auth configuration as an incidental part of a database migration.

## Consequences

The schema and interface stay small and match the actual user base. Database
policies remain strict even though there is only one permitted identity.

A second person can only be given access deliberately. Sharing one cellar with
another authorised identity is a smaller future change than supporting
separate cellars, but neither is part of this decision.

## Revisit when

Revisit this decision only if there is a concrete need for a separately owned
cellar, an invitation flow, delegated access with different permissions, or a
commercial product offered to other people.
