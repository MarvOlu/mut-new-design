<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

## What Lovable manages

Rules outside this block are the project's own. Change the pieces below in
Lovable, not by hand. With the [Lovable MCP](https://mcp.lovable.dev)
connected, `send_message` asks Lovable to do it; otherwise ask the user to
use the editor.

- **Database.** Do not add or edit `supabase/migrations/` or `drizzle/`.
  Ask Lovable to change the schema.
- **Generated files.** Do not edit a file whose header says it is automatically
  generated.
- **AI gateway.** Keep model calls on Lovable's gateway, and keep
  `LOVABLE_API_KEY` out of browser code.
- **Connectors.** Lovable provides native connectors. `list_connectors` shows
  which are enabled; `add_connector` only returns the dashboard link. When a
  connector is enabled, calls go through the connector gateway and need
  `LOVABLE_API_KEY`. When Lovable does not provide one, users can bring their
  own key and store it in Secrets.
- **Secrets.** Lovable manages them. Do not put secret values in the repo.

<!-- LOVABLE:END -->

## Project rules

- M-PESA (Daraja) calls live in `src/lib/mpesa.server.ts`; pure helpers in `src/lib/mpesa.ts`. Prices are always recomputed on the server from the `designs` table, never trusted from the browser.
- Payment status: Safaricom's callback (`/api/public/payments/callback`, guarded by `PAYMENT_CALLBACK_TOKEN` in the URL) and the STK Query fallback in `getOrderStatus` both update `orders`; the fallback keeps payments working when the callback cannot reach the app. Callback URLs must not contain "mpesa" or "--" (Daraja rejects them), so preview hosts fall back to STK Query only; the published host gets the real callback.
- Design files live in the private `designs` storage bucket under `<design-id>/<file>.<ext>`; the formats offered are whatever allowed files exist in that folder. Downloads are short-lived signed URLs issued only via `canDownload` (paid order containing the design). The order UUID is the buyer's access key; the `orders` table has no browser access.
- M-PESA config comes from secrets (`MPESA_ENV`, `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, optional `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_TRANSACTION_TYPE`, `MPESA_PARTY_B`, `SITE_URL`); sandbox shortcode/passkey are the defaults when `MPESA_ENV` isn't `production`.
- Design pictures come from `designs.images` (bundled keys mapped in `src/lib/design-images.ts`, or full https links), falling back to `image_key`; the basket lives in `BasketProvider` (root) and is saved in the browser so it survives page changes.
