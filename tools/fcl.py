"""Writer (and a small reader) for Columns UI .fcl configuration files.

Covers only what the Plinth build needs: the Layout dataset with a JSplitter root whose
children are Spider Monkey Panel / other panels, plus the Colours (unified) and Misc layout
datasets. Formats come from the Columns UI source (fcl.cpp, fcl_layout.cpp, fcl_colours.cpp,
colour_manager_data.cpp), Spider Monkey Panel 1.6 (panel_config_json.cpp), and — for JSplitter,
whose source is not public — byte-level experiments against JSplitter 4.2.2 (see docs/fcl-format.md).
"""
import json
import struct
import uuid

FCL_HEADER = uuid.UUID('9faadff3-e51a-4a8b-b4a3-d209a36ab301')
FCL_VERSION = 2
MODE_PUBLIC = 0

# datasets
DS_LAYOUT = uuid.UUID('2cf00365-f2d7-4e78-9fca-c1d56e2707d8')
DS_MISC_LAYOUT = uuid.UUID('78aa8894-4b2c-477d-b233-e7a7a7663d24')
DS_COLOURS = uuid.UUID('165946e7-6165-4680-a08e-84b5768458e8')

# panels
JSPLITTER = uuid.UUID('b42c29e2-486b-46cf-aa2c-f66fb1201bad')
SMP = uuid.UUID('32271525-436d-4afa-8dfd-437ab0c83118')
OPENLYRICS = uuid.UUID('6e24d0be-ad68-4bc9-a062-2ec7b353d5bd')
PANEL_NAMES = {JSPLITTER: 'JSplitter', SMP: 'Spider Monkey Panel', OPENLYRICS: 'OpenLyrics Panel'}


class Writer:
    def __init__(self):
        self.buf = bytearray()

    def u8(self, v):
        self.buf += struct.pack('<B', v)
        return self

    def u32(self, v):
        self.buf += struct.pack('<I', v & 0xFFFFFFFF)
        return self

    def i32(self, v):
        self.buf += struct.pack('<i', v)
        return self

    def u64(self, v):
        self.buf += struct.pack('<Q', v)
        return self

    def guid(self, g):
        self.buf += g.bytes_le
        return self

    def string(self, s):
        data = s.encode('utf-8')
        return self.u32(len(data)).raw(data)

    def raw(self, data):
        self.buf += data
        return self

    def blob(self, data):
        return self.u32(len(data)).raw(data)

    def item(self, ident, data):
        """fbh::fcl::Writer::write_item: u32 id, u32 size, payload."""
        return self.u32(ident).blob(data)

    def bytes(self):
        return bytes(self.buf)


# ---- Spider Monkey Panel / JSplitter settings ------------------------------------------------

SCRIPT_IN_MEMORY = 1
SCRIPT_PACKAGE = 4


def smp_settings(*, script=None, package=None, properties=None, panel_id):
    """Panel settings as SMP 1.6 / JSplitter store them: u32 SettingsType (2 = JSON) + JSON string."""
    if package is not None:
        script_type = SCRIPT_PACKAGE
        payload = {k: package[k] for k in ('id', 'name', 'author', 'version')}
    else:
        script_type = SCRIPT_IN_MEMORY
        payload = {'isModuleScript': False, 'script': script}
    settings = {
        'id': 'settings',
        'version': '1',
        'panelId': panel_id,
        'scriptType': script_type,
        'payload': payload,
        'properties': {'id': 'properties', 'version': '1', 'values': properties or {}},
        'edgeStyle': 0,
        'isPseudoTransparent': False,
    }
    return Writer().u32(2).string(json.dumps(settings, indent=2, ensure_ascii=False)).bytes()


def jsplitter_child(panel_guid, config, *, caption, rect=(0, 0, 100, 100), hidden=True,
                    locked=False, show_caption=False, pseudo_transparent=False, erase_background=False):
    """One entry of JSplitter's child table (format version 3)."""
    x, y, w, h = rect
    out = Writer().guid(panel_guid)
    out.u8(hidden).u8(locked).u8(show_caption)
    out.i32(x).i32(y).i32(w).i32(h)
    out.raw(bytes(11)).u8(pseudo_transparent)
    out.u64(len(config)).raw(config)
    out.u8(1).string(caption)            # use custom title + title (PanelObject.Text)
    out.string(PANEL_NAMES[panel_guid])  # panel name
    out.u8(erase_background)
    out.raw(b'\xff' * 8)
    return out.bytes()


def jsplitter(settings, children):
    out = Writer().raw(settings).u32(3).u32(len(children)).u32(0)
    for child in children:
        out.raw(child)
    return out.bytes()


# ---- datasets --------------------------------------------------------------------------------

def layout_dataset(presets, active=0):
    """presets: [(name, root panel guid, root panel config)]"""
    out = Writer().u32(0).u32(active).u32(len(presets))
    for name, root_guid, root_config in presets:
        out.guid(root_guid).string(name).blob(root_config)
    return out.bytes()


def misc_layout_dataset(*, status_bar=False, status_pane=False):
    return (Writer()
            .item(0, struct.pack('<i', int(status_bar)))
            .item(1, struct.pack('<?', status_pane))
            .item(2, struct.pack('<?', True))     # allow resizing of locked panels
            .item(3, struct.pack('<?', False))    # lock main window size
            .item(4, struct.pack('<?', False))    # legacy splitter sizing
            .bytes())


def _colorref(hex_colour):
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return struct.pack('<I', r | (g << 8) | (b << 16))


def colour_entry(*, text, selection_text, background, selection_background):
    return (Writer()
            .item(0, bytes(16))                       # entry id (global)
            .item(1, struct.pack('<I', 3))            # scheme: custom
            .item(5, _colorref(text))
            .item(6, _colorref(selection_text))
            .item(7, _colorref(selection_text))       # inactive selection text
            .item(2, _colorref(background))
            .item(3, _colorref(selection_background))
            .item(4, _colorref(selection_background))  # inactive selection background
            .item(9, struct.pack('<?', False))        # use custom active item frame
            .item(8, _colorref(selection_background))
            .bytes())


def colours_dataset(entry, *, dark_mode=True):
    empty_list = struct.pack('<I', 0)
    return (Writer()
            .item(4, struct.pack('<i', 1 if dark_mode else 0))
            .item(0, entry)       # global light
            .item(2, entry)       # global dark
            .item(1, empty_list)  # per-client light entries
            .item(3, empty_list)  # per-client dark entries
            .bytes())


def build(datasets, panels):
    """datasets: [(guid, name, [required panel guids], data)]"""
    out = Writer().guid(FCL_HEADER).u32(FCL_VERSION).u32(MODE_PUBLIC)
    out.u32(len(panels))
    for g in panels:
        out.guid(g).string(PANEL_NAMES[g])
    out.u32(len(datasets))
    for g, name, required, data in datasets:
        out.guid(g).string(name).u32(len(required))
        for p in required:
            out.u32(panels.index(p))
        out.blob(data)
    return out.bytes()


# ---- reader (for verification) ---------------------------------------------------------------

class Reader:
    def __init__(self, data, pos=0):
        self.data, self.pos = data, pos

    def u32(self):
        v = struct.unpack_from('<I', self.data, self.pos)[0]
        self.pos += 4
        return v

    def guid(self):
        g = uuid.UUID(bytes_le=bytes(self.data[self.pos:self.pos + 16]))
        self.pos += 16
        return g

    def string(self):
        n = self.u32()
        v = bytes(self.data[self.pos:self.pos + n]).decode('utf-8')
        self.pos += n
        return v

    def raw(self, n):
        v = bytes(self.data[self.pos:self.pos + n])
        self.pos += n
        return v


def read(data):
    r = Reader(data)
    if r.guid() != FCL_HEADER:
        raise ValueError('not an fcl file')
    version, mode = r.u32(), r.u32()
    panels = [(r.guid(), r.string()) for _ in range(r.u32())]
    datasets = []
    for _ in range(r.u32()):
        g, name = r.guid(), r.string()
        required = [r.u32() for _ in range(r.u32())]
        datasets.append((g, name, required, r.raw(r.u32())))
    return {'version': version, 'mode': mode, 'panels': panels, 'datasets': datasets}
