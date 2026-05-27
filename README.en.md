[简体中文](./README.md) | English

# Wechat Converter for Obsidian

Convert Obsidian Markdown into polished WeChat articles, then keep publishing to more platforms from the same workflow. Wechat Converter now supports live preview, copy-to-editor, WeChat draft sync, and beta multi-platform distribution through the Obsidian Publisher browser extension.

![Version](https://img.shields.io/badge/version-2.8.2-blue)
![Obsidian](https://img.shields.io/badge/Obsidian-1.0.0+-purple)
![License](https://img.shields.io/badge/license-MIT-green)
![Chrome Companion](https://img.shields.io/badge/Chrome%20Companion-Obsidian%20Publisher%20%E2%80%A2%20Coming%20Soon-7c3aed)

This plugin is built for writers who publish from Obsidian to WeChat Official Accounts and other Chinese content platforms. It focuses on the last mile of publishing: preserving layout, code blocks, math, images, and article metadata while keeping the workflow fast inside Obsidian.

> This project is deeply refactored from [ai-writing-plugins](https://github.com/Ceeon/ai-writing-plugins). Proper attribution is retained in this repository.

If this plugin saves you time when formatting, copying, or syncing WeChat articles, you can [support ongoing maintenance](./docs/support.md).

## Privacy and permissions

Wechat Converter does not include client-side telemetry and does not automatically upload your notes. Network access, local filesystem reads, and clipboard writes are used only when you explicitly run the related feature.

- **Network access and `fetch()` calls**: WeChat draft sync calls the official WeChat API, custom API proxy settings call the proxy URL you configure, AI layout calls the AI Provider you configure, and multi-platform delivery connects to the local companion browser extension service.
- **Local filesystem access**: The plugin reads local vault files only when processing images, covers, Mermaid exports, LaTeX exports, and other assets referenced by the current note.
- **Clipboard access**: Copy actions write the current rendered article to the system clipboard so you can paste it into the WeChat editor or another publishing surface.
- **Third-party accounts**: WeChat sync requires your own AppID and AppSecret. Other platforms are handled by the companion browser extension using the login state already present in your browser.
- **Companion browser extension**: Multi-platform publishing and Pro licensing are coordinated with Obsidian Publisher. The Obsidian plugin keeps the writing, rendering, platform selection, and task handoff inside your vault.

## Big Update: Multi-platform Publishing

Wechat Converter is no longer limited to WeChat Official Accounts. From the same `Publish & Distribute` window, you can send the current article to platforms such as Zhihu, Juejin, CSDN, Yuque, Xiaohongshu, and other targets supported by Obsidian Publisher.

- **WeChat still uses the official API path**: WeChat draft sync keeps the plugin's AppID / AppSecret flow, including cover, excerpt, multi-account support, and account-level defaults.
- **Other platforms use the browser extension path**: Obsidian Publisher handles real browser sessions and saves drafts through the user's logged-in browser state, so Obsidian does not need to embed every platform login.
- **Choose platforms before sending**: Open the publishing modal, switch to `Other platforms`, select the targets, and send the task to the browser extension.
- **Lightweight status inside Obsidian**: Settings and publishing views show bridge connectivity, selected platforms, and last-known login hints. Final draft links, failures, and retries remain in the Obsidian Publisher task window.
- **Built for multi-channel creators**: Write once in Obsidian, sync to WeChat, then push the same article into multiple platform draft boxes for final review and manual publishing.

> Multi-platform publishing is currently beta. Platform login state, draft creation, anti-abuse checks, result links, and retry behavior are handled by Obsidian Publisher. Obsidian focuses on writing, rendering, platform selection, and task delivery.
## Highlights

- Beta multi-platform publishing through the Obsidian Publisher browser extension.
- Live article preview with fast side-by-side rendering.
- Copy rich HTML directly into the WeChat editor.
- Sync articles to the WeChat draft box with multi-account support.
- Account-level draft defaults for source URL and comment settings.
- Math rendering with SVG output for better WeChat compatibility.
- Mermaid diagrams rendered by Obsidian preview, then rasterized to PNG on export for WeChat-safe copy and sync.
- Local image handling for wiki links, relative paths, absolute paths, and GIFs.
- Swipeable image blocks for step screenshots, comparisons, split long images, and sensitive-image gates.
- Wide tables stay horizontally scrollable instead of being squeezed or clipped on mobile.
- Visual settings panel with theme, typography, preview, code block controls, and quote style options.
- Experimental AI layout planning with provider profiles, built-in layout families, schema checks, and debug snapshots.
- Chinese punctuation normalization for rendered output, with protection for code and technical tokens.

<p align="center">
  <img src="images/setting_panel_light.png" alt="Settings panel (light)" height="460" />
  <img src="images/setting_panel_dark.png" alt="Settings panel (dark)" height="460" />
</p>

## Recent Updates

- Multi-platform publishing now lives in the publishing modal. Switch to `Other platforms` to send the rendered article to Obsidian Publisher, then let the browser extension save drafts on supported platforms such as Zhihu, Juejin, and CSDN.
- Obsidian Publisher bridge settings now include enablement, token verification, platform selection, connection testing, and optional login-status checks for selected platforms.
- AI layout planning now lives inside the converter workflow, with provider management, connection testing, built-in layout families, color palette switching, schema validation, and reusable debug snapshots.
- AI layout results can be reused per layout family, applied from cache, recolored without regenerating, and recovered after failed regeneration when a previous successful result exists.
- Mermaid diagrams keep the Obsidian preview experience, then switch to PNG automatically during copy and draft sync so WeChat does not strip or choke on large SVG payloads.
- Draft sync gained account-level publish defaults for supported WeChat fields, so each Official Account profile can keep its own source URL and comment preferences.
- Quote and callout styling now includes a neutral gray mode for calmer reading, plus semantic accents for common callout types such as `note`, `tip`, `warning`, and `danger`.

## Usage

1. Open the plugin from the left ribbon icon or the command palette with `Open Wechat Converter`.
2. Edit your Markdown note as usual. The right panel updates the article preview in real time.
3. Click `Copy to WeChat` to paste rich HTML into the WeChat editor.
4. Optionally click `Sync to Draft` after configuring your WeChat AppID and AppSecret in plugin settings.
5. For beta multi-platform distribution, enable Obsidian Publisher distribution in plugin settings, connect the browser extension, then use `Publish & Distribute` -> `Other platforms` to send the article to selected platform draft boxes.

### Horizontally scrollable content

#### Wide tables

Write normal Markdown tables. When a table has many columns or long cell content, the converter automatically wraps it in a horizontal scroll container for preview, copy, and draft sync:

```markdown
| Metric | Q1 | Q2 | Q3 | Q4 | Notes |
| --- | --- | --- | --- | --- | --- |
| Conversion rate | 12.4% | 15.8% | 18.1% | 21.6% | Keep the full table width |
```

#### Swipeable image blocks

Use Obsidian callout syntax to group multiple images into a swipeable horizontal block:

```markdown
> [!image-swipe] Swipe to view images
> ![[step-1.png]]
> ![[step-2.png]]
> ![Step 3](attachments/step-3.png)
```

For sensitive images, use `image-sensitive`. The first panel shows the warning, then readers can swipe to view the images:

```markdown
> [!image-sensitive] Sensitive images. Swipe to view.
> ![[image-1.png]]
> ![[image-2.png]]
```

You can also select multiple image lines, open the command palette (`Cmd/Ctrl + P`), and run `Insert image block` or `Insert sensitive image block`.

### Experimental AI layout planning

- Configure AI providers from the plugin settings page. The current UI supports OpenAI-compatible, Gemini-compatible, and Anthropic-compatible endpoints.
- Open `AI 编排` from the converter toolbar to generate layout suggestions for the current article.
- Choose from three built-in layout families: `Source-first`, `Tutorial cards`, and `Editorial lite`.
- Choose an automatic color recommendation or pick a specific palette before generation.
- Switch color palettes after generation to reuse the current layout structure without rerunning the full layout plan.
- Reopen cached results by layout family and apply them directly when the current article still matches the cached source.
- Review schema warnings, inspect layout JSON, or copy an AI debugging prompt before applying the result to preview.
- If regeneration fails, the last successful layout can still remain available instead of forcing you back to the plain preview immediately.

<table>
  <tr>
    <td align="center"><img src="images/AI.png" alt="AI layout panel before generation" height="400" /><br/><sub>1. Configure & Plan</sub></td>
    <td align="center"><img src="images/AI_completed.png" alt="AI layout panel with cached result" height="400" /><br/><sub>2. Generate & Cache</sub></td>
    <td align="center"><img src="images/AI_render.png" alt="AI layout applied to article preview" height="400" /><br/><sub>3. Apply to Preview</sub></td>
  </tr>
</table>

<p align="center">
  <img src="images/AI_setup.png" alt="AI layout settings" width="760" /><br/>
  <sub>Global AI layout settings (Providers & Cache management)</sub>
</p>

### Draft sync

- Supports up to 5 WeChat Official Account profiles.
- Each account can store draft defaults for `content_source_url`, comments, and fans-only comments.
- These defaults are intentionally limited to fields supported by the current WeChat draft flow.
- Uses `cover` and `excerpt` from frontmatter when available.
- Falls back to the first body image and auto-generated excerpt when not provided.
- Can optionally clean up a configured output directory after a successful sync.

### Mermaid export

- Mermaid diagrams rendered by Obsidian can stay visible in live preview.
- During copy and draft sync, Mermaid diagrams are rasterized to PNG so WeChat receives a safer export format.
- The export path tries to preserve the original Mermaid colors instead of applying math-specific SVG cleanup.

<p align="center">
  <img src="images/mermaid_render.png" alt="Mermaid diagram rendered in the converter preview" height="460" />
</p>

### Quote and callout styles

- Built-in themes now support a lighter quote style workflow, including a neutral gray mode for blockquotes.
- Callouts use semantic accent colors for common types such as `note`, `tip`, `warning`, and `danger`.
- Unknown callout types fall back to an info-style treatment instead of reusing the current theme color.

### Chinese punctuation normalization

The right-side settings panel includes `正文标点标准化`.

- Scope: preview, copy result, and draft sync output only.
- Does not modify the original Markdown file.
- Converts common ASCII punctuation into Chinese punctuation in Chinese writing context.
- Protects inline code, fenced code blocks, URLs, emails, file paths, CLI tokens, environment variables, math-like expressions, and other technical tokens.

### Cloudflare proxy

If WeChat API IP allowlisting is a problem in your network, you can use a Cloudflare Worker proxy. Detailed deployment steps and worker code are available in the Chinese guide:

- [Proxy setup in Chinese](./README.md#-代理设置解决-ip-白名单问题)

## Screenshots

<p align="center">
  <img src="images/phone_style.png" alt="Phone preview" height="420" />
  <img src="images/code_render.png" alt="Mac-style code block" height="420" />
</p>

## Who this is for

- Obsidian users publishing to WeChat Official Accounts
- Technical writers who need code, math, and image fidelity
- Chinese-language creators who want a faster publishing workflow

## Installation

### Manual install

1. Download the latest release from [GitHub Releases](https://github.com/DavidLam-oss/obsidian-wechat-converter/releases).
2. Extract the plugin into your vault under `.obsidian/plugins/obsidian-wechat-converter/`.
3. Make sure the folder contains:
   - `main.js`
   - `manifest.json`
   - `styles.css`
4. Reload Obsidian and enable the plugin.

### BRAT

1. Install and enable BRAT.
2. Add the repository `DavidLam-oss/obsidian-wechat-converter`.
3. After installation, do a quick smoke test:
   - Open the converter panel
   - Check preview rendering
   - Copy once to WeChat
   - Optionally test draft sync

## More docs

- Chinese documentation: [README.md](./README.md)
- Release notes: [RELEASE_NOTES](./RELEASE_NOTES/)

## License

MIT
