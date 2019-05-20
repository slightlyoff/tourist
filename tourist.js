/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author ebidel@ (Eric Bidelman)
 */

const puppeteer = require("puppeteer");
const pupDevices = require("puppeteer/DeviceDescriptors");
const chalk = require("chalk");
const Table = require("cli-table");
const args = require("commander");
const fs = require("fs");
const pfs = fs.promises;
const ora = require("ora");

function bToKiB(bytes) {
  if (bytes > 1024) {
    const formattedNum = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: 1
    }).format(bytes / 1024);
    return `${formattedNum} KiB`;
  }
  return `${bytes} bytes`;
}

function isFunctionGenerator(types=[], extensions=[]) {
  return function(r) {
    if (r.mimeType && types.indexOf(r.mimeType) != -1) {
      return true;
    }
    return false;
  }
}

// Greatly truncated from:
//  https://www.iana.org/assignments/media-types/media-types.xhtml
//  https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types
const isJSResource = isFunctionGenerator([
  "text/javascript",
  "text/javascript+module",
  "application/javascript",
  "application/x-javascript",
  "application/ecmascript",
  "text/ecmascript",
  "text/jscript",
]);

const isHTMLResource = isFunctionGenerator([
  "text/html",
  "application/xhtml+xml",
]);

const isFontResource = isFunctionGenerator([
  "application/font-woff",
  "font/collection",
  "font/otf",
  "font/sfnt",
  "font/ttf",
  "font/woff",
  "font/woff2",
]);

const isCSSResource = isFunctionGenerator([
  "text/css"
]);

const isImageResource = isFunctionGenerator([
  "image/gif",
  "image/jpeg",
  "image/pjpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/tiff",
  "image/xbm",
]);

class ResourceSize {
  constructor(rs={}) {
    this.url = rs.url || "";
    this.mimeType = rs.mimeType || "";
    this.encoded = rs.encodedDataLength || 0;
    this.decoded = rs.decodedBodyLength || 0;
  }

  add(rs) {
    this.encoded += rs.encoded;
    this.decoded += rs.decoded;
  }

  pctOf(rs) {
    return {
      encoded: ((this.encoded / rs.encoded) * 100).toFixed(2),
      decoded: ((this.decoded / rs.decoded) * 100).toFixed(2),
    };
  }
}

// We return an object with highlight stats, mostly in bytes
class TypeEntry extends ResourceSize {
  constructor(testFunc, name="") {
    super();
    this.name = name;
    this.largest = new ResourceSize();
    if (testFunc) {
      this.test = testFunc;
    }
  }

  test() {
    return true;
  }

  add(data) {
    if (this.test(data)) {
      super.add(data);
      if (data.encoded > this.largest.encoded) {
        this.largest = data;
      }
    }
  }
};

class DocumentStats extends TypeEntry {
  constructor() {
    super();
    this.name = "Document";
    this.html = new TypeEntry(isHTMLResource, "HTML");
    this.js =   new TypeEntry(isJSResource, "JavaScript");
    this.css =  new TypeEntry(isCSSResource, "CSS");
    this.img =  new TypeEntry(isImageResource, "Image");
    this.font = new TypeEntry(isFontResource, "Font");
  }

  add(data) {
    super.add(data);
    this.html.add(data);
    this.js.add(data);
    this.css.add(data);
    this.img.add(data);
    this.font.add(data);
  }

  summary() {
    let s = `
  >    Total size: ${bToKiB(this.encoded)} (${bToKiB(this.decoded)} uncompressed)
  >            JS: ${bToKiB(this.js.encoded)} (${this.js.pctOf(this).encoded}%)
  >    Largest JS: ${bToKiB(this.js.largest.encoded)} (${this.js.largest.pctOf(this).encoded}%)
  >                ${this.js.largest.url}
  >           CSS: ${bToKiB(this.css.encoded)} (${this.css.pctOf(this).encoded}%)
  >   Largest CSS: ${bToKiB(this.css.largest.encoded)} (${this.css.largest.pctOf(this).encoded}%)
  >                ${this.css.largest.url}
  >         Image: ${bToKiB(this.img.encoded)} (${this.img.pctOf(this).encoded}%)
  > Largest Image: ${bToKiB(this.img.largest.encoded)} (${this.img.largest.pctOf(this).encoded}%)
  >                ${this.img.largest.url}
`;
    return s;
  }
}

async function collectStats(resourceMap) {
  // `resourceMap` has a structure like...
  //
  //   'https://cdn.auth0.com/js/lock/11.3/lock.min.js' => { requestId: '1000073638.75',
  //  didFail: false,
  //  encodedDataLength: 376,
  //  decodedBodyLength: 764294,
  //  finishTime: 323809.602905,
  //  frame: '6C6D1BD89C4FCFEEFA24C2E15716E217',
  //  url: 'https://cdn.auth0.com/js/lock/11.3/lock.min.js',
  //  requestMethod: 'GET',
  //  priority: 'High',
  //  statusCode: 200,
  //  mimeType: 'application/javascript',
  //  fromCache: false,
  //  fromServiceWorker: false,
  //  timing:
  //   { requestTime: 323809.498124,
  //     ...
  //     pushEnd: 0 } },

  let ret = new DocumentStats();
  for (let [url, data] of resourceMap) {
    ret.add(new ResourceSize(data));
  }
  return ret;
}

async function canReadFiles(...files) {
  try {
    for (let f of files) {
      await pfs.access(f, fs.constants.R_OK);
    }
    return true;
  } catch(e) {
    return false;
  }
}

async function computeWebBS(stats, { aftImagePath, fullImagePath }=args) {
  // See: https://www.webbloatscore.com/
  if (!(await canReadFiles(aftImagePath, fullImagePath))) {
    return { aft: -1, full: -1 };
  }

  // Get image sizes
  let aftImageSize = (await pfs.stat(aftImagePath)).size;
  let fullImageSize = (await pfs.stat(fullImagePath)).size;
  return {
    aft: parseFloat(stats.encoded / aftImageSize),
    full: (stats.encoded / fullImageSize)
  };
}

class Browser {
  constructor(args={}) {
    this.args = args;
    this.browser = null;
    this.page = null;
  }

  async init() {
    if (!this.args.crawl) {
      return;
    }
    this.browser = await puppeteer.launch({
      headless: args.headless,
      defaultViewport: args.defaultViewport,
      ignoreHTTPSErrors: true,
    });
    let pages = await this.browser.pages();
    this.page = pages.length ? pages[0] : await this.browser.newPage();
    await this.page.setCacheEnabled(false);
    this.page.setDefaultNavigationTimeout(10 * 1000);
  }

  async getPage() {
    if (!this.browser || !this.page) {
      await this.init();
    }
    return this.page;
  }

  async close() {
    if (!this.browser) { return Promise.resolve(false); }
    return await this.browser.close();
  }
}

async function resourceMapFromTrace(tracefile) {
  let resourceMap = new Map();

  // Check for a tracefile; if we don't have one, bail.
  if (!(await canReadFiles(tracefile))) {
    return resourceMap;
  }

  // Grab trace data from JSON and record some headline numbers
  let events = JSON.parse(await pfs.readFile(tracefile)).traceEvents;
  // Loop over the events and catalog ResourceStart and ResourceFinish
  // events
  let started = new Map();
  let responseStarts = new Map();
  let finished = new Map();
  for (let e of events) {
    if (e.name === "ResourceSendRequest") {
      started.set(e.args.data.requestId, e.args.data);
    }
    if (e.name === "ResourceReceiveResponse") {
      responseStarts.set(e.args.data.requestId, e.args.data);
    }
    if (e.name === "ResourceFinish") {
      finished.set(e.args.data.requestId, e.args.data);
    }
  }

  // Now join them up, finding URLs for all finished resources
  for (let [id, value] of finished) {
    if (started.has(id)) {
      // Create an empty object to copy values into
      let v = {};
      if (!value.didFail) {
        Object.assign(v, started.get(id));
        if (responseStarts.has(id)) {
          Object.assign(v, responseStarts.get(id));
        }
        // We add the "finished" data last, as it's most authoritative
        // about transferred and uncompressed sizes
        Object.assign(v, value);
        resourceMap.set(v.url, v);
      }
    }
  }
  return resourceMap;
}

async function crawlUrl(url, devices, browser, args={ outdir: "./out" }) {
  let resourceMap = new Map();
  let tracefile = `${args.outdir}/trace.json`;
  if (!args.crawl) {
    // When crawling is disabled, try to use previous crawl output
    return resourceMapFromTrace(tracefile);
  }
  await pfs.mkdir(args.outdir, { recursive: true });

  let trace = true; // grab a trace on the first load
  let page = await browser.getPage();

  for(let d of devices) {
    let devicedir = `${args.outdir}/${d.short_name}`;
    await pfs.mkdir(devicedir, { recursive: true });
    page.setViewport(d.viewport);

    if (trace) {
      await page.tracing.start({ path: tracefile });
    }

    try {

      await page.goto(url, {
        // "domcontentloaded" "load", "networkidle2", "networkidle0"
        waitUntil: "networkidle2"
       });
      await page.screenshot({ path: `${devicedir}/screenshot.png` });
      if (trace) {
        trace = false;
        await page.tracing.stop();
        await page.screenshot({ path: `${args.outdir}/screenshot.aft.png` });
        await page.screenshot({
          fullPage: true,
          path: `${args.outdir}/screenshot.full.png`
        });
        resourceMap = resourceMapFromTrace(tracefile);
      }
    } catch(e) {
      if (trace) { await page.tracing.stop(); }
      throw e;
    }
  }
  return resourceMap;
}

async function getRetryUrls(urls, args) {
  let retry = [];
  for (let url of urls) {
    let u = new URL(url);
    let outdir = `${args.out}/${u.host}`;
    let aftImagePath = `${outdir}/screenshot.aft.png`;
    let fullImagePath = `${outdir}/screenshot.full.png`;
    if (!(await canReadFiles(outdir, aftImagePath, fullImagePath))) {
      retry.push(url);
    }
  }
  return retry;
}

async function analyse(args={}, spinner) {
  let urls = [];
  let devices = [];

  // TODO: check file perms ahead of time and bail on error
  try {
    if (args.urlsFile) {
      spinner.info(`Crawling locations in --urls-file: ${args.urlsFile}`);
      // TODO: check perms before trying to read
      urls = JSON.parse(await pfs.readFile(args.urlsFile));
      if (urls.length > args.crawlLimit) {
        urls.length = args.crawlLimit;
      }
    } else if(args.url) {
      spinner.info(`Crawling: ${args.url}`);
      urls.push(args.url);
    } else {
      spinner.fail("Please provide either a single url with `--url=...` or a list of URLs to crawl via `--urls-file=<path>`")
      return;
    }
    viewports = JSON.parse(await pfs.readFile(args.viewports));
    devices = viewports.devices;
    devices.sort((a, b) => {
      // Sort the devices list by the number of locations where it's
      // popular, most to least. This way, if we cap the number of devices we
      // run tests against, we try to include the most popular
      return Math.max(-1, Math.max(1, b.popular_in.length-a.popular_in.length));
    });

    if (args.desktop) {
      devices = [
        {
          "name": "Chrome Desktop",
          "short_name": "desktop",
          "url": "http://gs.statcounter.com/screen-resolution-stats/desktop/worldwide",
          "viewport": {
            "width": 1336,
            "height": 768,
            "deviceScaleFactor": 1.0,
            "isMobile": false,
            "hasTouch": false
          },
          "popular_in": []
        },
      ];
    }

    for(let item of devices) {
      if (item.alias) {
        if (!item.viewport) {
          item.viewport = pupDevices[item.alias].viewport;
        }
      }
    }
    if (devices.length > args.viewportsLimit) {
      devices.length = args.viewportsLimit;
    }
    args.defaultViewport = devices[0].viewport;
  } catch(e) {
    console.log(e);
    return;
  }

  let browser = new Browser(args);
  await browser.init();
  let page = await browser.getPage();

  let pageResources = new Map();

  if (args.continue) {
    let retryUrls = await getRetryUrls(urls, args);
    spinner.info(`Retrying ${retryUrls.length} of ${urls.length}`);
    urls = retryUrls;
  }

  for (let url of urls) {
    let u = new URL(url);

    // Cheeky to re-use the object this way, but ¯\_(ツ)_/¯
    args.outdir = `${args.out}/${u.host}`;
    args.aftImagePath = `${args.outdir}/screenshot.aft.png`;
    args.fullImagePath = `${args.outdir}/screenshot.full.png`;

    spinner.start(`Crawling: ${url}`);
    let resourceMap = new Map();
    try {
      resourceMap = await crawlUrl(url, devices, browser, args);
      pageResources.set(url, resourceMap);
    } catch(e) {
      spinner.fail(`${url}`);
      continue;
    }

    // If the output directory doesn't exist, bail and continue
    if (!(await canReadFiles(args.outdir))) {
      spinner.fail(`${url}`);
      spinner.info(`No output data!`);
      continue;
    } else {
      spinner.succeed(`${url}`);
    }

    spinner.info(`Analysing trace`);
    let stats = await collectStats(resourceMap);
    stats.url = url;
    // spinner.info(`Computing Web Bloat Score`);
    let webBS = await computeWebBS(stats, args);
    spinner.info(stats.summary());
    spinner.info(`> Web Bloat Score (AFT): ${webBS.aft.toFixed(2)}, Full page: ${webBS.full.toFixed(2)}`);
  }
  return await browser.close();
}

let toInt = (n) => { return parseInt(n, 10); };

(async() => {
  args.version("0.0.1")
    .option("--no-crawl",
            "Skip crawling, analyze previous results in --out directory")
    .option("--urls-file <urls>",
            "JSON file of URLS to crawl (array)", String)
    .option("--url <url>",
            "A single URLS to crawl", String)
    .option("--viewports <viewports>",
            "JSON file with device viewports", "./viewports.json", String)
    .option("--out <out>",
            "Output directory", "./out")
    .option("--crawl-limit <limit>",
            "Max urls to test", toInt, 1000)
    .option("--viewports-limit <limit>",
            "Max viewports to test", toInt, 1)
    .option("--desktop",
            "Test only a desktop viewport")
    .option("--no-headless",
            "Run in a visible browser window")
    .option("--continue",
            "Attempt to re-start a crawl")
    .option("--dry-run",
            "Avoid writing anything to disk")
    .parse(process.argv);

  let opt = Object.assign({}, args.opts());
  let spinner = ora("Analysing...").start();
  await analyse(opt, spinner);
  spinner.stop();
})();
