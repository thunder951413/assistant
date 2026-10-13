// GitHub web page automation: expanding hidden timeline items before extraction.


export async function githubPageGrowthSnapshot(page) {
  return page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    comments: document.querySelectorAll("[id^='issuecomment-']").length,
    textLength: document.body?.innerText?.length || 0
  }));
}

export async function clickGithubLoadMore(page) {
  // GitHub's issue/PR timeline lazily loads older items behind a button such
  // as `data-testid="issue-timeline-load-more-load-top"` ("Load more"). A DOM
  // `.click()` from page.evaluate does not always trigger the React handler,
  // so prefer a real Playwright pointer click on the known testid first, then
  // fall back to a text-based match for other "load more" controls.
  const knownSelectors = [
    "[data-testid='issue-timeline-load-more-load-top']",
    "[data-testid^='issue-timeline-load-more']"
  ];
  for (const selector of knownSelectors) {
    try {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 1500 }).catch(() => false);
      if (!visible) continue;
      const disabled = await locator.isDisabled().catch(() => true)
        || await locator.getAttribute("aria-disabled") === "true";
      if (disabled) continue;
      await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
      await locator.click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      return true;
    } catch {
      // Button may have disappeared or be mid-render; try the next strategy.
    }
  }

  const clicked = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const loadMorePattern = /(?:show|load|view)\s+more|more\s+items|remaining\s+items|查看更多|加载更多/i;
    const candidates = [...document.querySelectorAll("button, a, [role='button']")]
      .filter((el) => el instanceof HTMLElement)
      .filter((el) => {
        const text = [
          el.innerText,
          el.textContent,
          el.getAttribute("aria-label"),
          el.getAttribute("title")
        ].map(clean).filter(Boolean).join(" ");
        return loadMorePattern.test(text);
      });
    const target = candidates.find((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return !el.hasAttribute("disabled")
        && el.getAttribute("aria-disabled") !== "true"
        && style.visibility !== "hidden"
        && style.display !== "none"
        && rect.width > 0
        && rect.height > 0;
    });
    if (!target) return false;
    target.scrollIntoView({ block: "center", inline: "center" });
    target.click();
    return true;
  });
  if (clicked) {
    await page.waitForTimeout(1200);
  }
  return clicked;
}
