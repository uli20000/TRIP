# Iceland HTML + Supabase Edge Function + Notion

This project uses **Notion as the source of truth**. The Edge Function keeps the Notion token off the browser and provides the HTML app with a small API for travel pages and expense rows.

## Current Notion data sources

- Travel: `ae0c1976-e0a3-4cdb-ab05-eb38a30824c9`
- Expenses: `72f00f78-a326-43ee-8944-aa7d4bbe3452`

## Required setup

1. Create or open a Supabase project.
2. Create a Notion internal integration with read content, insert content, update content, and read/write page capabilities.
3. Share the Notion `行程規劃` and `5. 費用紀錄` data sources with that integration.
4. Set the function secrets from `.env.example` in Supabase. Never put `NOTION_TOKEN` in the HTML.
5. Deploy the function as `notion-sync`.
6. Configure the HTML with the deployed function URL and call it with a Supabase Auth session.

## API

- `GET /functions/v1/notion-sync?kind=travel`
- `GET /functions/v1/notion-sync?kind=expenses&content=false`
- `POST /functions/v1/notion-sync?kind=expenses`
- `PATCH /functions/v1/notion-sync?kind=expenses`
- `DELETE /functions/v1/notion-sync?kind=expenses`

POST/PATCH body example:

```json
{
  "properties": {
    "Name": "婚禮攝影",
    "類別": "婚禮",
    "狀態": "預估",
    "原幣別": "ISK",
    "原始金額": 0,
    "台幣估算": 0,
    "備註": "待報價"
  },
  "content": "## 備註\n\n待確認。"
}
```

This is the first backend slice. The next step is wiring the existing HTML buttons and forms to this API, then adding authentication and a visible sync status.


## GitHub deployment

This repository is ready for GitHub Actions. The workflow deploys the `supabase/` functions whenever changes are pushed to `main`. Supabase documents this CLI-based GitHub Actions flow for Edge Functions. See [Supabase GitHub Actions](https://supabase.com/docs/guides/functions/examples/github-actions).

1. Create a GitHub repository and push this folder.
2. In GitHub repository settings, add an Actions secret named `SUPABASE_ACCESS_TOKEN`.
3. The workflow uses the project ref in `.github/workflows/deploy-edge-function.yml`.
4. Push to `main` or run the workflow manually.
5. Add the Notion secrets in the Supabase project, not in GitHub:
   - `NOTION_TOKEN`
   - `NOTION_TRAVEL_DATA_SOURCE_ID`
   - `NOTION_EXPENSE_DATA_SOURCE_ID`
   - `NOTION_VERSION`
   - `WEB_ORIGIN`

The HTML still needs the API wiring and hosted deployment step. The current `web/index.html` is the visual starting point; the next code change will replace its localStorage calls with the deployed `notion-sync` API and add the sync status indicator.
