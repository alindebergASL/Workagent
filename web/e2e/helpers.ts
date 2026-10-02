import {
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

export const PRINCIPAL = "alex";
export const EVIDENCE_DIR =
  process.env["WORKAGENT_EVIDENCE_DIR"] ??
  path.resolve(process.cwd(), "../handoffs/frontend/evidence");
export const JOURNEY_FILE = path.join(EVIDENCE_DIR, "journey-ids.json");

export function headers(): Record<string, string> {
  return {
    "x-workagent-principal": PRINCIPAL,
    "content-type": "application/json",
  };
}

export async function shot(
  page: Page,
  info: TestInfo,
  name: string,
): Promise<void> {
  const dir = path.join(EVIDENCE_DIR, info.project.name);
  fs.mkdirSync(dir, { recursive: true });
  // Full-page capture pins sticky bars mid-page; render them in flow for the evidence image only.
  const style = await page.addStyleTag({
    content:
      ".sticky-actions{position:static !important;background:transparent !important}",
  });
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  });
  await style.evaluate((el) => el.remove());
}

export async function control(
  request: APIRequestContext,
  op: string,
  body: Record<string, string> = {},
): Promise<unknown> {
  const r = await request.post(`/api/mock/_control/${op}`, {
    data: body,
    headers: headers(),
  });
  expect(r.ok(), `control ${op}`).toBeTruthy();
  return r.json();
}

export async function noHorizontalScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "no horizontal page scroll").toBeLessThanOrEqual(
    clientWidth,
  );
}

export interface JourneyIds {
  assignment_id: string;
  plan_artifact_id: string;
  human_revision_id: string;
  human_revision_sequence: number;
  human_text: string;
  protected_note: string;
  final_revision_id: string;
  final_revision_sequence: number;
  proposal_ids: string[];
  recorded_at: string;
}

export function writeJourney(ids: JourneyIds): void {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(JOURNEY_FILE, JSON.stringify(ids, null, 2));
}

export function readJourney(): JourneyIds {
  return JSON.parse(fs.readFileSync(JOURNEY_FILE, "utf8")) as JourneyIds;
}
