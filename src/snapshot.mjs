export const REF_ATTRIBUTE = "data-bulu-ref"

const CONTROL_SELECTOR = [
  "a",
  "button",
  "input",
  "textarea",
  "select",
  "summary",
  '[role="button"]',
  '[role="link"]',
  '[role="textbox"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
].join(",")

function frameReader(input) {
  const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
  const truncate = (value, limit) => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value)
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false
    const style = window.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  const queryAllDeep = (root, selector) => {
    const found = Array.from(root.querySelectorAll(selector))
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) found.push(...queryAllDeep(element.shadowRoot, selector))
    }
    return found
  }
  const readLabel = (element) => {
    const ariaLabel = normalize(element.getAttribute("aria-label"))
    if (ariaLabel) return truncate(ariaLabel, 120)
    const labelledBy = normalize(element.getAttribute("aria-labelledby"))
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => normalize(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(" ")
      if (text) return truncate(text, 120)
    }
    if ("labels" in element && element.labels?.length) {
      const text = Array.from(element.labels)
        .map((label) => normalize(label.textContent))
        .filter(Boolean)
        .join(" ")
      if (text) return truncate(text, 120)
    }
    const id = normalize(element.id)
    if (id) {
      const text = normalize(document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent)
      if (text) return truncate(text, 120)
    }
    return ""
  }

  if (!input.preserveRefs)
    queryAllDeep(document, `[${input.refAttribute}]`).forEach((element) => element.removeAttribute(input.refAttribute))

  const candidates = queryAllDeep(document, input.controlSelector).filter(isVisible)
  const localOffset = Math.max(0, input.refOffset - input.seenRefs)
  const slice = candidates.slice(localOffset, localOffset + Math.max(0, input.maxRefs - input.returnedRefs))
  const refs = slice.map((element, index) => {
    const ref = `${input.epoch}:${input.seenRefs + localOffset + index + 1}`
    element.setAttribute(input.refAttribute, ref)
    const type = "type" in element ? normalize(element.type) : ""
    return {
      ref,
      tag: element.tagName.toLowerCase(),
      role: normalize(element.getAttribute("role")) || undefined,
      type: type || undefined,
      label: readLabel(element) || undefined,
      text: truncate(normalize(element.innerText || element.textContent), 120) || undefined,
      placeholder: truncate(normalize(element.getAttribute("placeholder")), 120) || undefined,
      value:
        "value" in element && !["password", "hidden"].includes(type)
          ? truncate(normalize(element.value), 120) || undefined
          : undefined,
      checked:
        element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
          ? element.indeterminate
            ? "mixed"
            : element.checked
          : element.hasAttribute("aria-checked")
            ? element.getAttribute("aria-checked") === "mixed"
              ? "mixed"
              : element.getAttribute("aria-checked") === "true"
            : undefined,
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true" || undefined,
      selected: element.hasAttribute("aria-selected")
        ? element.getAttribute("aria-selected") === "true"
        : undefined,
      expanded: element.hasAttribute("aria-expanded") ? element.getAttribute("aria-expanded") === "true" : undefined,
    }
  })

  const scope = input.selector ? queryAllDeep(document, input.selector).filter(isVisible) : []
  const scoped = scope.filter((element) => !scope.some((other) => other !== element && other.contains(element)))
  const allText = normalize(
    input.selector
      ? scoped.map((element) => element.innerText ?? element.textContent ?? "").join("\n")
      : document.body?.innerText ?? "",
  )
  const localTextOffset = Math.max(0, input.textOffset - input.seenText)
  const bodyText = allText.slice(localTextOffset, localTextOffset + Math.max(0, input.maxTextChars - input.returnedText))

  const surfaces = queryAllDeep(
    document,
    'dialog,[role="dialog"],[aria-modal="true"],[popover],[aria-haspopup],[popovertarget],a[download],form[action*="download" i]',
  )
    .filter(isVisible)
    .slice(0, 20)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      text: truncate(normalize(element.textContent), 160) || undefined,
      href: element instanceof HTMLAnchorElement ? element.href : undefined,
    }))

  return {
    url: location.href,
    title: document.title,
    text: bodyText,
    totalTextChars: allText.length,
    totalRefs: candidates.length,
    matchedTargets: scoped.length,
    refs,
    surfaces,
    frames: window.frames.length,
  }
}

export async function captureSnapshot(page, options = {}) {
  const limit = {
    textOffset: clamp(options.textOffset, 0, Number.MAX_SAFE_INTEGER, 0),
    refOffset: clamp(options.refOffset, 0, Number.MAX_SAFE_INTEGER, 0),
    maxTextChars: clamp(options.maxTextChars, 200, 50_000, 12_000),
    maxRefs: clamp(options.maxRefs, 0, 500, 120),
  }
  const epoch = options.epoch ?? 0
  const snapshots = []
  let seenText = 0
  let seenRefs = 0

  for (const frame of page.frames()) {
    const returnedText = snapshots.reduce((total, item) => total + item.text.length, 0)
    const returnedRefs = snapshots.reduce((total, item) => total + item.refs.length, 0)
    const snapshot = await frame
      .evaluate(frameReader, {
        refAttribute: REF_ATTRIBUTE,
        controlSelector: CONTROL_SELECTOR,
        preserveRefs: options.preserveRefs === true,
        selector: options.selector,
        epoch,
        seenText,
        seenRefs,
        textOffset: limit.textOffset,
        refOffset: limit.refOffset,
        maxTextChars: limit.maxTextChars,
        maxRefs: limit.maxRefs,
        returnedText,
        returnedRefs,
      })
      .catch(() => undefined)
    if (!snapshot) continue
    snapshots.push(snapshot)
    seenText += snapshot.totalTextChars
    seenRefs += snapshot.totalRefs
  }

  const text = snapshots
    .map((item) => item.text)
    .filter(Boolean)
    .join("\n---\n")
    .slice(0, limit.maxTextChars)
  const refs = snapshots.flatMap((item) => item.refs).slice(0, limit.maxRefs)
  const totalTextChars = Math.max(...snapshots.map((item) => item.totalTextChars), 0)
  const totalRefs = Math.max(...snapshots.map((item) => item.totalRefs), 0)
  const returnedTextChars = snapshots.reduce((total, item) => total + item.text.length, 0)
  const nextTextOffset = limit.textOffset + returnedTextChars < totalTextChars ? limit.textOffset + returnedTextChars : undefined
  const nextRefOffset = limit.refOffset + refs.length < totalRefs ? limit.refOffset + refs.length : undefined

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    text,
    refs,
    snapshot: {
      textOffset: limit.textOffset,
      refOffset: limit.refOffset,
      returnedTextChars,
      returnedRefs: refs.length,
      totalTextChars,
      totalRefs,
      textComplete: nextTextOffset === undefined,
      refsComplete: nextRefOffset === undefined,
      nextTextOffset,
      nextRefOffset,
      complete: nextTextOffset === undefined && nextRefOffset === undefined,
      selector: options.selector,
    },
    surfaces: snapshots.flatMap((item) => item.surfaces ?? []).slice(0, 20),
  }
}

export async function semanticState(page) {
  return page
    .evaluate(() => {
      const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim()
      const visible = (element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
      }
      const controls = Array.from(document.querySelectorAll("input,textarea,select")).filter(visible)
      return {
        url: location.href,
        title: document.title,
        text: normalize(document.body?.innerText ?? "").slice(0, 2000),
        count: controls.length,
        values: controls.slice(0, 40).map((element) => `${element.tagName}:${element.value ?? ""}`),
      }
    })
    .catch(() => ({ url: page.url(), title: "", text: "", count: 0, values: [] }))
}

export function clamp(value, minimum, maximum, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)))
}
