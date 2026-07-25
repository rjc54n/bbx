# BBX web client

The Next.js client contains the public BBX catalogue and the owner-only cellar
interface.

## Local development

Use Node.js 22, matching the production runtime declared in `package.json`.

Create `apps/web/.env.local` with the public Supabase connection values:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
```

The browser and server use the public key. Do not add a service-role key to the
web project.

Run:

```bash
cd /Users/richardcarvell/PycharmProjects/bbx/apps/web
npm install
npm run dev
```

The public catalogue is at `http://localhost:3000`. The owner login is at
`http://localhost:3000/login`.

Password setup and recovery use Supabase's standard implicit recovery flow:

1. `/forgot-password` requests the Supabase recovery email.
2. Supabase's standard Recovery template redirects to
   `/auth/update-password` with the recovery session in the URL fragment. No
   custom SMTP or email-template edit is required.
3. The browser client validates the recovery session before it displays the
   password form.
4. `/auth/update-password` updates the password directly through Supabase,
   signs the recovery session out and returns to a fresh cookie-backed login.

Set the Supabase Auth Site URL to the stable production origin. Keep the local
and any intended preview origins in the Auth redirect allowlist.
`NEXT_PUBLIC_SITE_URL` can override the recovery origin. Otherwise the reset
request uses its validated request origin; local development falls back to
`http://localhost:3000`.

## Checks

```bash
npm run lint
npm test
npm run build
```

The database workflow replays all migrations on a clean local Supabase
database, lints the public schema and runs the pgTAP tests under
`supabase/tests/database`.

## Owner bootstrap

Do this separately in each environment after the cellar migration has been
applied:

1. Create the single owner in Supabase Auth and verify the email address.
2. Copy the user's stable UUID from the Auth users page.
3. Insert it through an administrative SQL session:

   ```sql
   INSERT INTO public.app_owners (user_id)
   VALUES ('00000000-0000-0000-0000-000000000000')
   ON CONFLICT (user_id) DO NOTHING;
   ```

4. Disable new sign-up and anonymous sign-in in Supabase Auth.
5. Test that the owner can sign in and that another authenticated account
   cannot read the personal tables or private Storage bucket.

There is no public owner-registration or bootstrap route.

## Vercel release

The application can run on Vercel without a service-role secret. Configure the
same two public Supabase environment variables for the intended Vercel
environment.

Before exposing the cellar routes:

- apply and verify the database migration through the chosen production
  migration owner;
- provision the owner allowlist row;
- disable sign-up;
- configure the Vercel production URL in Supabase Auth;
- finish the required multi-factor authentication flow; and
- verify owner and non-owner access against the deployed URL.

The migration and owner bootstrap come before the Vercel release. Deploying
the current code against the old schema would make the cellar pages fail
closed, but it would not provide a usable upload facility.
