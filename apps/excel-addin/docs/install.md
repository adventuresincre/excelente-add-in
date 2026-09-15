---
title: Install Excelente
description: Install from Microsoft Marketplace or from the Add-ins button inside Excel. Takes about a minute.
group: First steps
order: 1
---

Excelente installs like any other Office add-in. Both paths below land you in the same place: an
**excelente** button on Excel's Home tab that opens the task pane.

## From inside Excel

This is the shorter path, and it works on Windows, Mac, and the web.

1. Open the **Home** tab.
2. Click **Add-ins**.
3. Search for **Excelente**.
4. Click **Add**.

Excel installs it against your Microsoft 365 account, so it follows you to your other machines.

## From Microsoft Marketplace

Open the [Excelente listing](https://marketplace.microsoft.com/en-us/product/WA200012017) and click
**Get it now**. Microsoft will ask which account to install it under, then hand you back to Excel.

## Requirements

Excelente needs **Microsoft 365**. It declares Office's `ExcelApi 1.9` requirement set, which is the
highest set the add-in uses unconditionally.

| Host | Supported |
|---|---|
| Excel for Windows (Microsoft 365) | Yes |
| Excel for Mac (Microsoft 365) | Yes |
| Excel on the web (Microsoft 365) | Yes |
| Excel 2016, Excel 2019 (perpetual) | No |
| Excel on iPad or mobile | No |

Excel 2016 and 2019 are excluded deliberately. They do not implement `ExcelApi 1.9`, so core
features like screenshots and worksheet events would throw rather than degrade, and a half-working
agent in your workbook is worse than a clear "not supported".

One feature asks for more: inserting an attached spreadsheet as new worksheets needs `ExcelApi 1.13`,
which means Excel 2021 or Microsoft 365. When that is unavailable, Excelente reads the file as text
instead. See [Attachments](/documentation/attachments/).

## Opening the task pane

After installing, look for the **excelente** group on the Home tab and click the **excelente**
button. The pane opens on the right side of your workbook and stays with that workbook.

The pane refuses to load outside Excel. If you open `excelente.aiedge.ac/taskpane.html` in a browser
you get a notice rather than a working add-in, because the agent has no workbook to read.

## What happens next

The first time the pane opens you get a short setup flow: pick how you want to connect a model, pick
the model, and optionally turn on connectors. That is covered in
[Connect a model](/documentation/connect-a-model/).

## Uninstalling

**Home** → **Add-ins** → **My add-ins**, right-click Excelente, then **Remove**. Your API key lives
in Office's per-user add-in storage and goes with it. Workbook memory written to the hidden
`_excelente` sheet stays in the file; delete that sheet if you want it gone.
