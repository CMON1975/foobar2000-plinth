"""Build Plinth.fcl — the importable Columns UI configuration for the Plinth theme.

    python tools/build_plinth.py                  # writes Plinth.fcl (scripts embedded)
    python tools/build_plinth.py --dev            # scripts loaded from this checkout instead
    python tools/build_plinth.py --out X.fcl --debug-dir C:/tmp/plinth-debug

By default the scripts in scripts/ are embedded in the layout (lib/common.js inlined in place of
its include), so the .fcl works on any machine. --dev makes the layout's scripts tiny stubs that
include() the files from this checkout instead, so edits apply on panel reload without
re-importing — but the .fcl then only works while the checkout stays where it is.
"""
import argparse
import uuid
from pathlib import Path

import fcl

REPO = Path(__file__).resolve().parent.parent
SCRIPTS = REPO / 'scripts'
COMMON_INCLUDE = "include(`${PLINTH_DIR}lib/common.js`);"

LIBRARY_TREE = {'id': '{E85C9EF0-778B-46DD-AF20-F4BE831360DD}', 'name': 'Library Tree', 'author': 'WilB', 'version': '2.4.0'}
BIOGRAPHY = {'id': '{BA9557CE-7B4B-4E0E-9373-99F511E81252}', 'name': 'Biography', 'author': 'WilB', 'version': '1.4.2'}

# Must match SHADES.soft in scripts/lib/common.js
PALETTE = {
    'g1': '#212121', 'g2': '#272727', 'g3': '#303030', 'g4': '#383838', 'g5': '#444444',
    't1': '#E8E6E2', 't2': '#BDBBB6', 't3': '#989692',
}


def rgb_csv(name):
    h = PALETTE[name]
    return ','.join(str(int(h[i:i + 2], 16)) for i in (1, 3, 5))


def custom_colours(mapping):
    """WilB packages: 'Custom Colour X' = 'r,g,b' plus 'Custom Colour X Use' = true."""
    props = {}
    for prop, colour in mapping.items():
        props[f'Custom Colour {prop}'] = rgb_csv(colour) if colour in PALETTE else colour
        props[f'Custom Colour {prop} Use'] = True
    return props


LIBRARY_TREE_PROPS = {
    'Custom Font': 'Bahnschrift,16,0',
    'Custom Font Use': True,
    'Custom Font Node Icon': 'lucide',
    'Node: Style': 6,
    'Node Custom Icon: +|-': '\ue06f|\ue06d',  # Lucide chevron-right | chevron-down
    'Node: Show Lines': False,
    'Node: Root Hide-0 All Music-1 View Name-2': 0,
    'Node: Item Counts Hide-0 Tracks-1 Sub-Items-2': 2,
    'Row Stripes': False,
    'Full Line Selection': True,
    'Show Settings': False,
    'Margin': 24,
    'Tree Indent': 26,
    'Line Padding': 6,
    'Scrollbar Colour Grey-0 Blend-1': 1,
    **custom_colours({
        'Background': 'g2', 'Background Accent': 'g3', 'Background Selected': 'g3',
        'Frame Hover': 'g3', 'Frame Selected': 'g3',
        'Text': 't2', 'Text Highlight': 't1', 'Text Selected': 't1', 'Text Nowplaying Highlight': 't1',
        'Search Text': 't1', 'Buttons': 't3', 'Item Counts': 't3',
        'Node Collapse': 't3', 'Node Expand': 't3', 'Node Hover': 't1', 'Node Lines': 'g4',
        'Separators': 'g4', 'Side Marker': 't1',
    }),
}

BIOGRAPHY_PROPS = {
    'Custom Font': 'Bahnschrift,17,0',
    'Custom Font Use': True,
    'Custom Font Heading': 'Bahnschrift Light,30,0',
    'Custom Font Heading Use': True,
    'Layout': 0,
    'Layout Image Size 0-1': 0.4,
    'Layout Margin Image Left': 48,
    'Layout Margin Image Right': 48,
    'Layout Margin Image Top': 24,
    'Layout Margin Image Bottom': 0,
    'Layout Margin Text Left': 48,
    'Layout Margin Text Right': 48,
    'Layout Margin Text Top': 24,
    'Layout Margin Text Bottom': 40,
    'Layout Margin Between Image & Text': 28,
    'Photo Style [Dual Mode] Regular-0 Auto-Fill-1 Circular-2': 1,
    'Filmstrip Show': False,
    'Heading Line Hide-0 Bottom-1 Center-2': 0,
    'Heading Button Show': False,
    'Heading Flag Artist View': False,
    'Heading Show Button Background': False,
    'Highlight Heading Line': False,
    'Scrollbar Type Default-0 Styled-1 WindowsLightMode-2 WindowsDarkMode-3': 1,
    'Scrollbar Colour Grey-0 Blend-1': 1,
    **custom_colours({
        'Background': 'g2', 'Text': 't2', 'Text Highlight': 't1', 'Heading Text': 't1',
        'Heading Button': 't3', 'Line': 'g4', 'Summary': 't3', 'Rating Stars': 't2',
        'Film Active Item Frame': 't3',
    }),
}


def embedded(script_name):
    """The script with lib/common.js inlined in place of its include()."""
    source = (SCRIPTS / script_name).read_text(encoding='utf-8')
    if source.count(COMMON_INCLUDE) != 1:
        raise SystemExit(f'{script_name}: expected exactly one line {COMMON_INCLUDE}')
    common = (SCRIPTS / 'lib' / 'common.js').read_text(encoding='utf-8')
    return source.replace(COMMON_INCLUDE, f'// ---- lib/common.js (inlined by tools/build_plinth.py) ----\n{common}')


def stub(script_name, header):
    scripts_dir = SCRIPTS.as_posix() + '/'
    return (f"// {header}\n"
            f"// Loads the theme from the repository so edits apply on panel reload.\n"
            f"const PLINTH_DIR = '{scripts_dir}';\n"
            f"include(PLINTH_DIR + '{script_name}');\n")


def script(script_name, header, dev):
    return stub(script_name, header) if dev else embedded(script_name)


def panel_id(name):
    return '{' + str(uuid.uuid5(uuid.NAMESPACE_URL, f'plinth/{name}')).upper() + '}'


def build(dev=False, debug_dir=None):
    debug = {'Plinth.DebugDir': debug_dir} if debug_dir else {}

    children = [
        fcl.jsplitter_child(fcl.SMP, fcl.smp_settings(package=LIBRARY_TREE, properties=LIBRARY_TREE_PROPS,
                                                      panel_id=panel_id('library')), caption='Library'),
        fcl.jsplitter_child(fcl.SMP, fcl.smp_settings(script=script('playlist.js', 'Plinth — playlist drawer', dev),
                                                      properties=debug, panel_id=panel_id('playlist')),
                            caption='Playlist'),
        fcl.jsplitter_child(fcl.OPENLYRICS, b'', caption='Lyrics'),
        fcl.jsplitter_child(fcl.SMP, fcl.smp_settings(package=BIOGRAPHY, properties=BIOGRAPHY_PROPS,
                                                      panel_id=panel_id('about')), caption='About'),
    ]
    root_props = {**debug, 'Plinth.View': 'playlist'} if debug_dir else {}
    root_settings = fcl.smp_settings(script=script('plinth.js', 'Plinth — root', dev), properties=root_props,
                                     panel_id=panel_id('root'))
    root = fcl.jsplitter(root_settings, children)

    colours = fcl.colour_entry(text=PALETTE['t2'], selection_text=PALETTE['t1'],
                               background=PALETTE['g2'], selection_background=PALETTE['g3'])
    panels = [fcl.JSPLITTER, fcl.SMP, fcl.OPENLYRICS]
    datasets = [
        (fcl.DS_COLOURS, 'Colours (unified)', [], fcl.colours_dataset(colours, dark_mode=True)),
        (fcl.DS_MISC_LAYOUT, 'Misc layout', [], fcl.misc_layout_dataset()),
        (fcl.DS_LAYOUT, 'Layout', panels, fcl.layout_dataset([('Plinth', fcl.JSPLITTER, root)])),
    ]
    return fcl.build(datasets, panels)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=str(REPO / 'Plinth.fcl'))
    ap.add_argument('--dev', action='store_true', help='load the scripts from this checkout instead of embedding them')
    ap.add_argument('--debug-dir', help='test builds only: panels write logs/snapshots here')
    args = ap.parse_args()
    data = build(args.dev, args.debug_dir.replace('\\', '/') if args.debug_dir else None)
    Path(args.out).write_bytes(data)
    print(f'wrote {args.out} ({len(data)} bytes)')


if __name__ == '__main__':
    main()
