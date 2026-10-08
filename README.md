# Adverifact

Adverifact is a browser-driven demo workflow for reviewing ecommerce ad creatives. The React Flow canvas owns the active session and calls FastAPI one stage at a time. The API processes a request, returns its result, and forgets the run when that request ends.

## Project layout

- `web/` contains the React, Vite, and React Flow workspace.
- `web/worker/` serves the built frontend and forwards API requests to FastAPI in a Cloudflare Container.
- `backend/` contains FastAPI, creative preflight, and the stage processors.
- `backend/app/defaults.py` contains the starter questionnaire and editable ad-quality skill.

## Session and data handling

- Editable workflow settings are saved in the current browser's `sessionStorage`.
- Selected ad files and active run results stay in browser memory. The browser sends the current `RunView` to FastAPI with each stage request; normalized and annotated images travel as data URLs.
- FastAPI creates request-scoped temporary files for image processing, removes them when each request ends, and does not keep a run registry, upload archive, event log, or spend ledger.
- Reloading or closing the tab clears selected files and the active run. The editable text settings can remain for the browser tab session.
- No database, R2 bucket, or Durable Workflow stores user workflow data. The Cloudflare Container runtime uses its required Durable Object binding for container lifecycle only; the application does not write run or asset data to it.

## Local development

1. Copy `backend/.env.example` to `backend/.env` and add an OpenRouter API key with a spend limit configured in your OpenRouter account.
2. Start one FastAPI development server in a terminal:

       uv run --directory backend uvicorn app.main:app --reload --env-file .env

3. Start one Vite development server in a second terminal:

       cd web && npm install && npm run dev

Open <http://localhost:5173>.

Keep one copy of each server running while developing. Stop each with `Ctrl+C` in its terminal. Vite binds to localhost and exits if its port is already occupied, rather than silently starting another server on a higher port. `npm run build` is a one-shot production build and exits when complete. `npm run cf:dev` is a separate long-running local Worker/Container runtime; use it instead of the Vite/FastAPI pair when checking the Cloudflare path, and stop it with `Ctrl+C` when finished.

## Browser-driven workflow

When the user selects **Run workflow**, the browser calls these endpoints in order and updates the graph from each response:

1. `POST /api/workflow/preflight` validates uploads, renders PDF pages, and normalizes images with Pillow-RS.
2. `POST /api/workflow/factual-qa` runs Decisions API checks for product, offer, claims, and questionnaire facts.
3. `POST /api/workflow/quality` scores the creative against the editable quality skill.
4. `POST /api/workflow/reports` creates separate factual and quality reports and draws numbered annotations.
5. `POST /api/workflow/gate` applies the configured pass threshold. If it requires a person, the browser waits for approval or rejection. Only approval with image improvements enabled calls `POST /api/workflow/image-edits` to produce four drafts.

Each response contains the updated session view and events from that node. The browser marks the node as running, presents its question results, and chooses the next endpoint; there is no backend task, WebSocket, polling loop, or automatic stage advancement.

When image improvements are enabled, the creative-quality report identifies the product image and draws a blue protection box in its annotation. Each generated draft is then post-processed: the original source pixels inside that box are copied back into the draft, so the model cannot alter product details there. If the model cannot locate the complete product boundary with high confidence, image generation is skipped. This protects product appearance without asking the user to upload a separate product photo.

The API caps uploads at 20 MB each and 10 files, and analyzes up to eight rendered pages. The default quality threshold is 84; syntax and claim probabilities and the maximum medium-issue count can be configured in the gate node. That threshold was selected with synthetic fixtures and needs validation against human-labeled reviews before production use.

The per-run spend estimate is a browser-carried guardrail because this demo does not persist a spend ledger. Configure a spend limit in OpenRouter as the billing limit. Decisions use `openai/gpt-6-luna-decisions`; structured reports use `openai/gpt-6-luna`; image edit drafts use `openai/gpt-image-2.5-sunburst`, OpenAI's precision-oriented GPT Image 2.5 variant. Image edit generation defaults to low quality; `OPENROUTER_IMAGE_QUALITY` changes it. The key remains on the server and is never sent to the browser.

## Cloudflare deployment

FastAPI runs in a Linux Cloudflare Container because Pillow-RS and PDFium require native libraries. The Worker serves Vite's static build, forwards `/api/*` requests to the Container, and injects the OpenRouter secret only for the Decisions, Responses, and Images endpoints. This app deploys as a Cloudflare Worker (`*.workers.dev`), since it needs a Worker and Container rather than Pages-only hosting.

To deploy on every push to `main`, the repository includes `.github/workflows/deploy-cloudflare.yml`. Add these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token allowed to deploy the `soft-star-0dd4` Worker and its Container.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account ID that owns the Worker.

The workflow installs the web dependencies, runs the production build, then deploys the Worker and Container with Wrangler. The Wrangler `name` is `soft-star-0dd4` and must match the target Worker. GitHub Actions' hosted Linux runner provides Docker for the Container image build.

Set `OPENROUTER_API_KEY` separately as a **Worker runtime secret** in Cloudflare under the Worker’s Settings → Variables & Secrets. The Worker injects it into FastAPI for OpenRouter requests. It is not a GitHub build secret and must not be committed to the repository.

For a local one-shot deploy instead, run `npx wrangler login` from `web/`, add the key with `npx wrangler secret put OPENROUTER_API_KEY --config wrangler.jsonc`, then run `npm run cf:deploy` with Docker running locally. This command builds and deploys the Worker and Container, then exits.

The Worker retains only the Container binding needed to run FastAPI. It does not configure R2, a workflow binding, a user-state Durable Object, or a budget ledger.
