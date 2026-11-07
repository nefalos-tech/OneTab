import { expect, test } from "@playwright/test";
import { FIXTURES, fixtureCases } from "../src/client/fixtures";

test("every sample address, /samples and /?sample return 404", async ({ request }) => {
  const paths = ["/samples", "/?sample", ...fixtureCases().flatMap((c) => [c.state.source.links.room, c.state.source.links.result])];
  for (const path of paths) expect((await request.get(path)).status(), path).toBe(404);
});

test("plain / is the live create form and links no samples", async ({ page }) => {
  expect((await page.goto("/"))?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Split a purchase");
  await expect(page.getByRole("link", { name: /sample/i })).toHaveCount(0);
  await expect(page.getByText("Sample data")).toHaveCount(0);
});

for (const [name, entry] of Object.entries(FIXTURES)) {
  test(`the UUID of ${name} never shows sample data`, async ({ page }) => {
    const response = await page.goto(`/checkouts/${entry.snapshot.checkout.id}/result?as=spot-1`);
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Sample data")).toHaveCount(0);
  });
}
