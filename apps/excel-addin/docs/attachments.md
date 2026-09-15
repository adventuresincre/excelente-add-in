---
title: Attachments
description: Send images, PDFs, and spreadsheets to the agent, and what each one costs you in limits.
group: Working in Excel
order: 3
---

Attach with the paperclip, paste an image straight into the composer, or drag files onto the chat
panel.

Accepted: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.pdf`, `.xlsx`, `.xlsm`, `.xls`, `.xlsb`, `.csv`.

## Images

Sent to the model as images, labelled with the filename so the agent can refer to them. Use them for
offering memoranda pages, a screenshot of someone else's model, a photo of a term sheet, a chart you
want rebuilt.

**Limit: 8 MB per image.** Oversized files are rejected before encoding:

> "site-plan.png" is 12.4MB, over the 8.0MB limit for a single image. Resize or crop it and attach it
> again.

The rejection happens up front on purpose. An oversized image that made it into the conversation
would sit in history and fail again on every subsequent turn.

Your model has to be able to see images. If it cannot, Excelente warns you in the composer and you
should switch models or expect the attachment to go unread. See
[Choosing a model](/documentation/choosing-a-model/).

## PDFs

Rendered page by page to JPEG and sent as images, with live progress in the attachment chip
(`· page 3 of 12`). The agent sees the pages as pictures, which means it reads scanned documents as
well as digital ones.

| Limit | Value |
|---|---|
| Pages | 100 |
| Rendered payload | 28 MB |
| Page size | 16M pixels, 8,192px longest edge, clamped automatically |

Over a limit, you get told which one and what to do:

> "offering-memo.pdf" has 140 pages, which exceeds the 100-page limit. Please split or trim the
> document and try again.

> "offering-memo.pdf" is too large for the model: rendered 42 of 80 pages and hit 28.3MB (limit
> 28.0MB). Try splitting the PDF, removing image-heavy pages, or sending fewer pages at a time.

The 28 MB ceiling sits under OpenRouter's 30 MB request cap with room to spare.

In practice, attach the pages you need. A 90-page OM sent whole costs real money in image tokens and
buries the rent roll you actually wanted in 85 pages of photography.

## Spreadsheets

Dropping an Excel file asks you a question first:

> **How would you like the agent to handle this file?**

### Insert worksheets

Adds the sheets to your open workbook at full fidelity, values, formulas, and formatting intact. The
agent then reads them like any other sheet and can build from them directly.

Requires `ExcelApi 1.13`, which means Excel 2021 or Microsoft 365, and a file under 25 MB. When
either is missing the option is disabled with the reason:

> Inserting worksheets needs Excel 2021 or Microsoft 365.
>
> File is too large to insert. Read as text instead.

If the native insert fails for any other reason, Excelente falls back to the text path and says so
rather than dropping the attachment.

### Read as text

Parses each sheet to CSV and sends it as text. Works on any model, needs no vision, and handles
binary `.xlsb` that the insert path cannot.

It flattens to values, so **formulas and formatting are lost**, and it truncates at **500 rows per
sheet**:

> … [12,340 more rows truncated — insert the file as worksheets to give the agent the full data]

### Which to pick

Insert worksheets when the file is the subject of the work: a rent roll to standardize, a T-12 to
normalize, a model to audit. Read as text when you want a quick look at a reference file without
adding sheets to your workbook.

`.csv` skips the question entirely. It has no worksheets to insert, so it always takes the text path.

`.xlsm` can be inserted, but macros are not imported. The card says so.

## Attachment chips

Each attachment shows an icon (🖼 image, 📄 PDF, 📊 spreadsheet), the filename, and what happened to
it: `· 12 pages`, `· 4 sheets (text)`, `· inserted 3 sheets`.

## On Mac

Excel for Mac runs the pane in WKWebView, which has tighter memory limits. The 8 MB image cap is
sized for it, and large PDF pages get clamped more aggressively. A page that cannot render at all
tells you its dimensions and suggests exporting at a smaller page size.
