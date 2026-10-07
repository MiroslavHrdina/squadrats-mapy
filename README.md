# Squadrats for Mapy.com (Brave / Chrome)

Draws the squadrat (zoom 14) and squadratinho (zoom 17) grids and your visited
tiles on top of Mapy.com, so you can plan a route in Mapy.com around the tiles
you still need. The overlay ignores the mouse, so planning works as usual.

## Install in Brave

1. Unzip the folder somewhere permanent.
2. Open `brave://extensions`, switch on **Developer mode** (top right).
3. Click **Load unpacked** and select the unzipped folder.
4. Optionally pin the extension from the puzzle-piece menu.

## Use

1. On squadrats.com open the map and use **Download KML**.
2. Click the extension icon, then **Import KML & calibrate…**, choose the file and click **Import**.
   Squadrats and squadratinhos can be one file or two; choose the matching option if auto-detection guesses wrong.
3. Open mapy.com (reload the tab if it was already open). Orange lines are squadrats, blue lines squadratinhos, green and amber fills are visited ones.
4. The popup toggles each grid and each fill separately.

## Notes

- Mapy.com offers no map API to extensions, so the overlay reads centre and zoom from the page URL
  (`?x=…&y=…&z=…`). The grid is a little delayed while you drag or zoom and snaps into place afterwards.
- If the grid ever looks shifted or the wrong size, use the alignment settings on the options page.
- Visited tiles are stored locally in the browser. Nothing is sent anywhere.
- To refresh your visited tiles, download a new KML and import it again.
