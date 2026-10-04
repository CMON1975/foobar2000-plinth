# Columns UI `.fcl` format notes

What `tools/fcl.py` relies on. Columns UI and Spider Monkey Panel details come from their source
(`reupen/columns_ui`: `fcl.cpp`, `fcl_layout.cpp`, `splitter_window.cpp`, `fcl_colours.cpp`,
`colour_manager_data.cpp`; `TheQwertiest/foo_spider_monkey_panel` v1.6.1: `panel_config_json.cpp`).
JSplitter's source isn't public; its part was worked out by importing generated files into an
isolated portable foobar2000 test instance and reading back what JSplitter reported and exported.
Verified against Columns UI 3.7.0, JSplitter 4.2.2, Spider Monkey Panel x64 1.7.26.1.2.

All integers are little-endian. `string` = `u32 length` + UTF-8 bytes (no terminator).
`GUID` = 16 bytes in Windows (`bytes_le`) order.

## Container

```
GUID   9faadff3-e51a-4a8b-b4a3-d209a36ab301
u32    version (2)
u32    mode    (0 = public/export format, 1 = private/raw config — quiet CLI export writes 1)
u32    panel count, then per panel: GUID, string name     -- import fails if any is not installed
u32    dataset count, then per dataset:
         GUID, string name, u32 n + n × u32 (indices into the panel list), u32 size, data
```

Datasets used here:

| GUID | name | content |
|---|---|---|
| `2cf00365-…-c1d56e2707d8` | Layout | `u32 0`, `u32 active`, `u32 count`, per preset `GUID root panel, string name, u32 size, root config` |
| `165946e7-…-84b5768458e8` | Colours (unified) | items (below) |
| `78aa8894-…-a7663d24` | Misc layout | items: 0 status bar (`i32`), 1 status pane, 2 allow locked resizing, 3 lock window size, 4 legacy sizing (bools) |

"Items" are `u32 id, u32 size, payload` records (`fbh::fcl::Writer::write_item`).

Colours (unified): 4 = dark mode (`i32`: 0 off, 1 on, 2 follow system); 0/2 = global light/dark
entry; 1/3 = per-client light/dark entry lists (`u32 count` + items with id 0). An entry is items:
0 id (GUID), 1 scheme (`u32`, 3 = custom), 2 background, 3 selection background, 4 inactive
selection background, 5 text, 6 selection text, 7 inactive selection text (`COLORREF` = `0x00BBGGRR`),
9 use custom focus frame (bool), 8 focus frame colour.

## Spider Monkey Panel settings (also JSplitter's own settings)

`u32 2` (JSON) + `string` JSON:

```json
{ "id": "settings", "version": "1", "panelId": "{…}", "scriptType": 1,
  "payload": { "isModuleScript": false, "script": "…" },
  "properties": { "id": "properties", "version": "1", "values": { "name": value } },
  "edgeStyle": 0, "isPseudoTransparent": false }
```

`scriptType`: 1 in-memory (`payload.script`), 2 sample (`sampleName`), 3 file (`path`, `locationType`
0 full / 1 component / 2 profile / 3 foobar2000), 4 package (`id`, `name`, `author`, `version`).

## JSplitter

```
SMP-style settings (above)
u32 3            child table version
u32 count
u32 0
count × child
```

Child:

```
GUID    panel
u8      hidden
u8      locked
u8      show caption
i32 ×4  x, y, width, height
11 × u8 unknown (0)
u8      pseudo-transparent
u64     config size, then the child panel's config
u8      use custom title
string  custom title          -- PanelObject.Text; what window.GetPanel(caption) matches
string  panel name
u8      erase background
8 bytes FF FF FF FF FF FF FF FF  -- public (mode 0) format only
```

The trailing 8 bytes are the one difference between the two modes: JSplitter's mode-1 export has no
trailer, but a mode-0 import without it misreads every child after the first. `TopMost` isn't stored;
the last child in the table reports `true`.
