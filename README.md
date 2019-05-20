# tourist

Travel the web they said, it'll be fun they said.

> Tourist uses Puppeteer to run [headless](https://developers.google.com/web/updates/2017/04/headless-chrome) Chrome to take screenshots and traces of websites for very basic, high-level analysis. It computes a [Web Bloat Score](https://www.webbloatscore.com/) relative to a specified viewport (mobile by default) and outputs "first clues" for performance investigation to stdout.

## Getting Started

Tourist takes either a single url to crawl:

```bash
node tourist.js --url="https://infrequently.org"
```

Or a file containing a single JSON array of URLs to crawl:

```bash
node tourist.js --urls-file=urls.json
```

Tourist then starts headless Chrome, loads the URL(s), takes screenshots of them, and saves a [Chrome Trace](https://www.chromium.org/developers/how-tos/trace-event-profiling-tool) which can be loaded in either `chrome:tracing` or Chrome Devtools for further inspection.

Output is dropped into an output directory (by default, `./out/`), which can be changed with `--out`, e.g.:

```bash
node tourist.js --out=/tmp/out/ --url="https://infrequently.org"
```

By default, Tourist prints high-level analysis info for each URL,

```
> node tourist.js --out=/tmp/out/ --url="https://infrequently.org"
ℹ Crawling: https://infrequently.org
✔ https://infrequently.org
ℹ Analysing trace
ℹ
  >    Total size: 435.1 KiB (684.4 KiB uncompressed)
  >            JS: 72 KiB (16.54%)
  >    Largest JS: 27.9 KiB (6.40%)
  >                https://platform.twitter.com/widgets.js
  >           CSS: 62.9 KiB (14.46%)
  >   Largest CSS: 54.5 KiB (12.52%)
  >                https://platform.twitter.com/css/tweet.a28c81a0749466df66438c06af00639d.light.ltr.css
  >         Image: 165 KiB (37.93%)
  > Largest Image: 159.5 KiB (36.64%)
  >                https://infrequently.org/wp-content/uploads/2018/09/http_archive_js_bytes_chart-1-768x393.png

ℹ > Web Bloat Score (AFT): 2.47, Full page: 0.06
```

Additionally, Tourist generates a directory structure that includes screenshots of the pages above-the-fold ("AFT") content as well as the full page in PNG format.

```
slightlyoff:~ > cd /tmp/out
slightlyoff:/tmp/out > find .
.
./infrequently.org
./infrequently.org/iphone_6_7_8
./infrequently.org/iphone_6_7_8/screenshot.png
./infrequently.org/trace.json
./infrequently.org/screenshot.full.png
./infrequently.org/screenshot.aft.png
```

Screenshots are taken for each of the specified viewports (which include dimensions as well as DPR). By default, only a single viewport is used. Viewports are selected from an included list of popular mobile devices (`./viewports.json`), sorted by frequency.

Tourist can obtain a fuller list of screenshots though `--viewports-limit`, e.g.:

```bash
node tourist.js --viewports-limit=10 --out=/tmp/out/ --url="https://infrequently.org"
```

```
slightlyoff:/tmp/out > find .
.
./infrequently.org
./infrequently.org/iphone_6_7_8
./infrequently.org/iphone_6_7_8/screenshot.png
./infrequently.org/trace.json
./infrequently.org/galaxy_j2
./infrequently.org/galaxy_j2/screenshot.png
./infrequently.org/galaxy_j5
./infrequently.org/galaxy_j5/screenshot.png
./infrequently.org/xperia_xz1
./infrequently.org/xperia_xz1/screenshot.png
./infrequently.org/redmi_note_4
./infrequently.org/redmi_note_4/screenshot.png
./infrequently.org/galaxy_s8
./infrequently.org/galaxy_s8/screenshot.png
./infrequently.org/screenshot.full.png
./infrequently.org/screenshot.aft.png
```

An optional (single) desktop form-factor is built-in too, for those not yet living in the new global mobile-first (if not mobile-only) reality:

```bash
node tourist.js --desktop --out=/tmp/out/ --url="https://infrequently.org"
```

outputs...

```
ℹ Crawling: https://infrequently.org
✔ https://infrequently.org
ℹ Analysing trace
ℹ
  >    Total size: 304.9 KiB (554.8 KiB uncompressed)
  >            JS: 71.9 KiB (23.59%)
  >    Largest JS: 27.9 KiB (9.14%)
  >                https://platform.twitter.com/widgets.js
  >           CSS: 62.9 KiB (20.64%)
  >   Largest CSS: 54.5 KiB (17.87%)
  >                https://platform.twitter.com/css/tweet.a28c81a0749466df66438c06af00639d.light.ltr.css
  >         Image: 34.5 KiB (11.32%)
  > Largest Image: 29.7 KiB (9.73%)
  >                https://infrequently.org/wp-content/uploads/2018/09/http_archive_js_bytes_chart-1-300x154.png

ℹ > Web Bloat Score (AFT): 1.56, Full page: 0.08
```

```
slightlyoff:~ > cd /tmp/out
slightlyoff:/tmp/out > find .
.
./infrequently.org
./infrequently.org/trace.json
./infrequently.org/desktop
./infrequently.org/desktop/screenshot.png
./infrequently.org/screenshot.full.png
./infrequently.org/screenshot.aft.png
```

## Large Crawls

Tourist is currently a sequential, single-process system. This is likely to change! It currently crawls sites one-at-a-time which, given the overhead inherent in running a full browser instance and dumping/analysing full traces, can take some time.

Occasionally in large crawls, Chrome can crash and Tourist will fail. To recover from these situations and restart the crawl from (roughly) where one left off, use `--continue`:

```
node tourist.js --out=/tmp/out/ --urls-file=./urls.json

...things happen, including crawl failure...

node tourist.js --out=/tmp/out/ --urls-file=./urls.json --continue
```

Continuation looks for the presence of trace and top-level screenshot files in the output directory to decide which urls to re-crawl.

## Analysis Only

Lets say you've previously cralwed a large set of urls and only want to re-run the analysis (rather than, e.g., change the form-factor against which you are computing WebBS or taking new screenshots). Use `--no-crawl` to trigger this mode. Note that you'll still need to provide the URL(s) to analyse:

```
slightlyoff:/projects/tourist > time (node tourist.js --no-crawl --urls-file=./urls.json)
```

The system currently does not support a `--quiet` or non-interactive mode. Stay tuned.