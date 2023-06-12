/**
 * MIT License
 *
 * Copyright (c) 2018 Simo Ahava
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const { URL } = require(`url`);
const fs = require(`fs`);
const { promisify } = require(`util`);

const puppeteer = require(`puppeteer`);
const lighthouse = require(`lighthouse`);
const uuidv1 = require(`uuid/v1`);
const { Validator } = require(`jsonschema`);

const { BigQuery } = require(`@google-cloud/bigquery`);
const { PubSub } = require(`@google-cloud/pubsub`);
const { Storage } = require(`@google-cloud/storage`);

const bqSchema = require(`./bigquery-schema.json`);
const config = require(`./config.json`);
const configSchema = require(`./config.schema.json`);

// Make filesystem write work with async/await
const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);

// Initialize new GC clients
const bigquery = new BigQuery({
  projectId: config.projectId,
});
const pubsub = new PubSub({
  projectId: config.projectId,
});
const storage = new Storage({
  projectId: config.projectId,
});

const validator = new Validator();

const log = console.log;

/**
 * Function that runs lighthouse in a headless browser instance.
 *
 * @param {string} id ID of the source for logging purposes.
 * @param {string} url URL to audit.
 * @returns {Promise<object>} The object containing the lighthouse report.
 */
async function launchBrowserWithLighthouse(id, url) {
  log(`${id}: Starting browser for ${url}`);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });

  log(`${id}: Browser started for ${url}`);

  config.lighthouseFlags = config.lighthouseFlags || {};

  config.lighthouseFlags.port = new URL(browser.wsEndpoint()).port;

  log(`${id}: Starting lighthouse for ${url}`);

  const lhr = await lighthouse(url, config.lighthouseFlags);

  log(`${id}: Lighthouse done for ${url}`);

  await browser.close();

  log(`${id}: Browser closed for ${url}`);

  return lhr;
}

/**
 * Parse the Lighthouse report into an object format corresponding to the BigQuery schema.
 *
 * @param {object} obj The lhr object.
 * @param {string} id ID of the source.
 * @returns {object} The parsed lhr object corresponding to the BigQuery schema.
 */
function createJSON(obj, id) {
  return {
    fetch_time: obj.fetchTime,
    site_url: obj.finalUrl,
    site_id: id,
    settings: obj.configSettings,

    accessibility: [
      {
        total_score: obj.categories.accessibility.score,
        bypass_repetitive_content: obj.audits.bypass.score === 1,
        color_contrast: obj.audits['color-contrast'].score === 1,
        document_title_found: obj.audits['document-title'].score === 1,
        no_duplicate_id_attribute: obj.audits['duplicate-id'].score === 1,
        html_has_lang_attribute: obj.audits['html-has-lang'].score === 1,
        html_lang_is_valid: obj.audits['html-lang-valid'].score === 1,
        images_have_alt_attribute: obj.audits['image-alt'].score === 1,
        form_elements_have_labels: obj.audits['label'].score === 1,
        links_have_names: obj.audits['link-name'].score === 1,
        lists_are_well_formed: obj.audits['list'].score === 1,
        list_items_within_proper_parents: obj.audits['listitem'].score === 1,
        meta_viewport_allows_zoom: obj.audits['meta-viewport'].score === 1,
        tabindex: obj.audits['tabindex'].score === 1,
        td_headers_attr: obj.audits['td-headers-attr'].score === 1,
        valid_lang: obj.audits['valid-lang'].score === 1,
        layout_table: obj.audits['layout-table'].score === 1,
        frame_title: obj.audits['frame-title'].score === 1,
        button_name: obj.audits['button-name'].score === 1,
        aria_allowed_attr: obj.audits['aria-allowed-attr'].score === 1,
        aria_required_attr: obj.audits['aria-required-attr'].score === 1,
        aria_required_children:
          obj.audits['aria-required-children'].score === 1,
        aria_required_parent: obj.audits['aria-required-parent'].score === 1,
        aria_roles: obj.audits['aria-roles'].score === 1,
        aria_valid_attr_value: obj.audits['aria-valid-attr-value'].score === 1,
        aria_valid_attr: obj.audits['aria-valid-attr'].score === 1,
      },
    ],

    best_practices: [
      {
        total_score: obj.categories['best-practices'].score,
        uses_https: obj.audits['is-on-https'].score === 1,
        uses_http2: obj.audits['uses-http2'].score === 1,
        uses_passive_event_listeners:
          obj.audits['uses-passive-event-listeners'].score === 1,
        no_document_write: obj.audits['no-document-write'].score === 1,
        external_anchors_use_rel_noopener:
          obj.audits['external-anchors-use-rel-noopener'].score === 1,
        no_geolocation_on_start: obj.audits['geolocation-on-start'].score === 1,
        doctype_defined: obj.audits.doctype.score === 1,
        no_vulnerable_libraries:
          obj.audits['no-vulnerable-libraries'].score === 1,
        notification_asked_on_start:
          obj.audits['notification-on-start'].score === 1,
        avoid_deprecated_apis: obj.audits.deprecations.score === 1,
        allow_paste_to_password_field:
          obj.audits['password-inputs-can-be-pasted-into'].score === 1,
        errors_in_console: obj.audits['errors-in-console'].score === 1,
        images_have_correct_aspect_ratio:
          obj.audits['image-aspect-ratio'].score === 1,
        js_libraries: obj.audits['js-libraries'].score === 1,
        appcache_manifest: obj.audits['appcache-manifest'].score === 1,
      },
    ],

    performance: [
      {
        total_score: obj.categories.performance.score,
        first_contentful_paint: [
          {
            raw_value: obj.audits['first-contentful-paint'].rawValue,
            score: obj.audits['first-contentful-paint'].score,
          },
        ],
        first_meaningful_paint: [
          {
            raw_value: obj.audits['first-meaningful-paint'].rawValue,
            score: obj.audits['first-meaningful-paint'].score,
          },
        ],
        max_potential_fid: [
          {
            raw_value: obj.audits['max-potential-fid'].rawValue,
            score: obj.audits['max-potential-fid'].score,
          },
        ],
        speed_index: [
          {
            raw_value: obj.audits['speed-index'].rawValue,
            score: obj.audits['speed-index'].score,
          },
        ],
        interactive: [
          {
            raw_value: obj.audits.interactive.rawValue,
            score: obj.audits.interactive.score,
          },
        ],
        first_cpu_idle: [
          {
            raw_value: obj.audits['first-cpu-idle'].rawValue,
            score: obj.audits['first-cpu-idle'].score,
          },
        ],
      },
    ],

    pwa: [
      {
        total_score: obj.categories.pwa.score,
        load_fast_enough: obj.audits['load-fast-enough-for-pwa'].score === 1,
        works_offline: obj.audits['works-offline'].score === 1,
        installable_manifest: obj.audits['installable-manifest'].score === 1,
        uses_https: obj.audits['is-on-https'].score === 1,
        redirects_http_to_https: obj.audits['redirects-http'].score === 1,
        has_meta_viewport: obj.audits.viewport.score === 1,
        uses_service_worker: obj.audits['service-worker'].score === 1,
        works_without_javascript: obj.audits['without-javascript'].score === 1,
        splash_screen_found: obj.audits['splash-screen'].score === 1,
        themed_address_bar: obj.audits['themed-omnibox'].score === 1,
        content_width: obj.audits['content-width'].score === 1,
      },
    ],

    seo: [
      {
        total_score: obj.categories.seo.score,
        has_meta_viewport: obj.audits.viewport.score === 1,
        document_title_found: obj.audits['document-title'].score === 1,
        meta_description: obj.audits['meta-description'].score === 1,
        http_status_code: obj.audits['http-status-code'].score === 1,
        descriptive_link_text: obj.audits['link-text'].score === 1,
        is_crawlable: obj.audits['is-crawlable'].score === 1,
        robots_txt_valid: obj.audits['robots-txt'].score === 1,
        image_alt: obj.audits['image-alt'].score === 1,
        hreflang_valid: obj.audits.hreflang.score === 1,
        valid_rel_canonical: obj.audits['canonical'].score === 1,
        font_size_ok: obj.audits['font-size'].score === 1,
        plugins_ok: obj.audits.plugins.score === 1,
        tap_targets: obj.audits['tap-targets'].score === 1,
        structured_data: obj.audits['structured-data'].score === 1,
      },
    ],

    /* BEGINNING OF NEW FIELDS */

    opportunities: {
      time_to_first_byte: [
        {
          title: obj.audits['time-to-first-byte'].title,
          description: obj.audits['time-to-first-byte'].description,
          score: obj.audits['time-to-first-byte'].score,
          displayValue: obj.audits['time-to-first-byte'].displayValue,
        },
      ],
      redirects: [
        {
          title: obj.audits.redirects.title,
          description: obj.audits.redirects.description,
          score: obj.audits.redirects.score,
          numericValue: obj.audits.redirects.numericValue,
          numericUnit: obj.audits.redirects.numericUnit,
          displayValue: obj.audits.redirects.displayValue,
        },
      ],

      uses_rel_preload: [
        {
          title: obj.audits['uses-rel-preload'].title,
          description: obj.audits['uses-rel-preload'].description,
          score: obj.audits['uses-rel-preload'].score,
        },
      ],

      uses_rel_preconnect: [
        {
          title: obj.audits['uses-rel-preconnect'].title,
          description: obj.audits['uses-rel-preconnect'].description,
          score: obj.audits['uses-rel-preconnect'].score,
        },
      ],

      offscreen_images: [
        {
          title: obj.audits['offscreen-images'].title,
          description: obj.audits['offscreen-images'].description,
          score: obj.audits['offscreen-images'].score,
          /*   numericValue: obj.audits['offscreen-images'].numericValue,
          numericUnit: obj.audits['offscreen-images'].numericUnit,*/
          displayValue: obj.audits['offscreen-images'].displayValue,
        },
      ],

      render_blocking_resources: [
        {
          title: obj.audits['render-blocking-resources'].title,
          description: obj.audits['render-blocking-resources'].description,
          score: obj.audits['render-blocking-resources'].score,
          raw_Value: obj.audits['render-blocking-resources'].rawValue,
          displayValue: obj.audits['render-blocking-resources'].displayValue,
          /*numericValue: obj.audits['render-blocking-resources'].numericValue,
         numericUnit: obj.audits['render-blocking-resources'].numericUnit*/
        },
      ],

      unminified_css: [
        {
          title: obj.audits['unminified-css'].title,
          description: obj.audits['unminified-css'].description,
          score: obj.audits['unminified-css'].score,
          raw_Value: obj.audits['unminified-css'].rawValue,
          /* numericUnit: obj.audits['unminified-css'].numericUnit,
          displayValue: obj.audits['unminified-css'].displayValue*/
        },
      ],

      unminified_javascript: [
        {
          title: obj.audits['unminified-javascript'].title,
          description: obj.audits['unminified-javascript'].description,
          score: obj.audits['unminified-javascript'].score,
          raw_Value: obj.audits['unminified-javascript'].rawValue,
        },
      ],

      unused_css_rules: [
        {
          title: obj.audits['unused-css-rules'].title,
          description: obj.audits['unused-css-rules'].description,
          score: obj.audits['unused-css-rules'].score,
          displayValue: obj.audits['unused-css-rules'].displayValue,
          /* numericValue: obj.audits['unused-css-rules'].numericValue,
           numericUnit: obj.audits['unused-css-rules'].numericUnit*/
        },
      ],

      uses_webp_images: [
        {
          title: obj.audits['uses-webp-images'].title,
          description: obj.audits['uses-webp-images'].description,
          score: obj.audits['uses-webp-images'].score,
          displayValue: obj.audits['uses-webp-images'].displayValue,
        },
      ],

      uses_optimized_images: [
        {
          title: obj.audits['uses-optimized-images'].title,
          description: obj.audits['uses-optimized-images'].description,
          score: obj.audits['uses-optimized-images'].score,
        },
      ],

      uses_responsive_images: [
        {
          title: obj.audits['uses-responsive-images'].title,
          description: obj.audits['uses-responsive-images'].description,
          score: obj.audits['uses-responsive-images'].score,
        },
      ],

      uses_text_compression: [
        {
          title: obj.audits['uses-text-compression'].title,
          description: obj.audits['uses-text-compression'].description,
          score: obj.audits['uses-text-compression'].score,
        },
      ],

      efficient_animated_content: [
        {
          title: obj.audits['efficient-animated-content'].title,
          description: obj.audits['efficient-animated-content'].description,
          score: obj.audits['efficient-animated-content'].score,
        },
      ],
    },
    diagnostics: {
      total_byte_weight: [
        {
          title: obj.audits['total-byte-weight'].title,
          description: obj.audits['total-byte-weight'].description,
          score: obj.audits['total-byte-weight'].score,
          displayValue: obj.audits['total-byte-weight'].displayValue,
        },
      ],

      uses_long_cache_ttl: [
        {
          title: obj.audits['uses-long-cache-ttl'].title,
          description: obj.audits['uses-long-cache-ttl'].description,
          score: obj.audits['uses-long-cache-ttl'].score,
          displayValue: obj.audits['uses-long-cache-ttl'].displayValue,
        },
      ],

      dom_size: [
        {
          title: obj.audits['dom-size'].title,
          description: obj.audits['dom-size'].description,
          score: obj.audits['dom-size'].score,
          displayValue: obj.audits['dom-size'].displayValue,
        },
      ],

      critical_request_chains: [
        {
          title: obj.audits['critical-request-chains'].title,
          description: obj.audits['critical-request-chains'].description,
          score: obj.audits['critical-request-chains'].score,
          displayValue: obj.audits['critical-request-chains'].displayValue,
        },
      ],

      user_timings: [
        {
          title: obj.audits['user-timings'].title,
          description: obj.audits['user-timings'].description,
          score: obj.audits['user-timings'].score,
          displayValue: obj.audits['user-timings'].displayValue,
        },
      ],

      bootup_time: [
        {
          title: obj.audits['bootup-time'].title,
          description: obj.audits['bootup-time'].description,
          score: obj.audits['bootup-time'].score,
          displayValue: obj.audits['bootup-time'].displayValue,
        },
      ],

      mainthread_work_breakdown: [
        {
          title: obj.audits['mainthread-work-breakdown'].title,
          description: obj.audits['mainthread-work-breakdown'].description,
          score: obj.audits['mainthread-work-breakdown'].score,
          displayValue: obj.audits['mainthread-work-breakdown'].displayValue,
        },
      ],

      font_display: [
        {
          title: obj.audits['font-display'].title,
          description: obj.audits['font-display'].description,
          score: obj.audits['font-display'].score,
          rawValue: obj.audits['font-display'].rawValue,
        },
      ],

      frame_title: [
        {
          title: obj.audits['frame-title'].title,
          description: obj.audits['frame-title'].description,
          score: obj.audits['frame-title'].score,
          rawValue: obj.audits['frame-title'].rawValue,
        },
      ],

      /*  network_requests: [{
        title: obj.audits['network-requests'].title,
        description: obj.audits['network-requests'].description,
        score: obj.audits['network-requests'].score,
        rawValue: obj.audits['network-requests'].rawValue,
      }],

      network_rtt: [{
        title: obj.audits['network-rtt'].title,
        description: obj.audits['network-rtt'].description,
        score: obj.audits['network-rtt'].score,
        rawValue: obj.audits['network-rtt'].rawValue,
        displayValue: obj.audits['network-rtt'].displayValue,
      }],

      network_server_latency: [{
        title: obj.audits['network-server-latency'].title,
        description: obj.audits['network-server-latency'].description,
        score: obj.audits['network-server-latency'].score,
        rawValue: obj.audits['network-server-latency'].rawValue,
        displayValue: obj.audits['network-server-latency'].displayValue,
      }],
      
      main_thread_tasks: [{
        title: obj.audits['main-thread-tasks'].title,
        description: obj.audits['main-thread-tasks'].description,
        score: obj.audits['main-thread-tasks'].score,
        rawValue: obj.audits['main-thread-tasks'].rawValue,
      }],
      
      screenshot_thumbnails: [{
        title: obj.audits['screenshot-thumbnails'].title,
        description: obj.audits['screenshot-thumbnails'].description,
        score: obj.audits['screenshot-thumbnails'].score,
        rawValue: obj.audits['screenshot-thumbnails'].rawValue,
      }],

      final_screenshot: [{
        title: obj.audits['final-screenshot'].title,
        description: obj.audits['final-screenshot'].description,
        score: obj.audits['final-screenshot'].score,
        rawValue: obj.audits['final-screenshot'].rawValue,
      }],*/
    },
  };
}

/* END OF NEW FIELDS*/

/**
 * Converts input object to newline-delimited JSON
 *
 * @param {object} data Object to convert.
 * @returns {string} The stringified object.
 */
function toNdjson(data) {
  data = Array.isArray(data) ? data : [data];
  let outNdjson = '';
  data.forEach((item) => {
    outNdjson += JSON.stringify(item) + '\n';
  });
  return outNdjson;
}

/**
 * Publishes a message to the Pub/Sub topic for every ID in config.json source object.
 *
 * @param {array<string>} ids Array of ids to publish into Pub/Sub.
 * @returns {Promise<any[]>} Resolved promise when all IDs have been published.
 */
async function sendAllPubsubMsgs(ids) {
  return await Promise.all(
    ids.map(async (id) => {
      const msg = Buffer.from(id);
      log(`${id}: Sending init PubSub message`);
      await pubsub.topic(config.pubsubTopicId).publisher().publish(msg);
      log(`${id}: Init PubSub message sent`);
    })
  );
}

/**
 * Write the lhr log object and reports to GCS. Only write reports if lighthouseFlags.output is defined in config.json.
 *
 * @param {object} obj The lighthouse audit object.
 * @param {string} id ID of the source.
 * @returns {Promise<void>} Resolved promise when all write operations are complete.
 */
async function writeLogAndReportsToStorage(obj, id) {
  const bucket = storage.bucket(config.gcs.bucketName);
  config.lighthouseFlags.output = config.lighthouseFlags.output || [];
  await Promise.all(
    config.lighthouseFlags.output.map(async (fileType, idx) => {
      //let filePath = `${id}/report_${obj.lhr.fetchTime}`;
      let filePath = `full_reports/${id}_report_${obj.lhr.fetchTime}`;
      let mimetype;
      switch (fileType) {
        case 'csv':
          mimetype = 'text/csv';
          filePath += '.csv';
          break;
        case 'json':
          mimetype = 'application/json';
          filePath += '.json';
          break;
        default:
          filePath += '.html';
          mimetype = 'text/html';
      }
      const file = bucket.file(filePath);
      log(
        `${id}: Writing ${fileType} report to bucket ${config.gcs.bucketName}`
      );
      return await file.save(obj.report[idx], {
        metadata: { contentType: mimetype },
      });
    })
  );

  //    const file = bucket.file(`${id}_log_${obj.lhr.fetchTime}.json`);
  //    log(`${id}: Writing log to bucket ${config.gcs.bucketName}`);
  //    return await file.save(JSON.stringify(obj.lhr, null, " "), {
  //      metadata: {contentType: 'application/json'}
  //    });
}

// Custom function
async function writeJsonResult(json, id) {
  const bucket = storage.bucket(config.gcs.bucketName);
  config.lighthouseFlags.output = config.lighthouseFlags.output || [];
  const file = bucket.file(`results/${id}_desktop_output.json`);
  /*${config.lighthouseFlags.emulatedFormFactor} NOT WORKING*/
  log(`${id}: Writing OUTPUT to bucket ${config.gcs.bucketName}`);
  return await file.save(json, {
    metadata: { contentType: 'application/json' },
  });
}
/**
 * Check events in GCS states.json to see if an event with given ID has been pushed to Pub/Sub less than
 * minTimeBetweenTriggers (in config.json) ago.
 *
 * @param {string} id ID of the source (and the Pub/Sub message).
 * @param {number} timeNow Timestamp when this method was invoked.
 * @returns {Promise<object>} Object describing active state and time delta between invocation and when the state entry was created, if necessary.
 */
async function checkEventState(id, timeNow) {
  let eventStates = {};
  try {
    // Try to load existing state file from storage
    const destination = `/tmp/state_${id}.json`;
    await storage
      .bucket(config.gcs.bucketName)
      .file(`states/${id}_state.json`)
      //.file(`state_${id}json`)
      .download({ destination: destination });
    eventStates = JSON.parse(await readFile(destination));
  } catch (e) {}

  // Check if event corresponding to id has been triggered less than the timeout ago
  const delta = id in eventStates && timeNow - eventStates[id].created;
  if (delta && delta < config.minTimeBetweenTriggers) {
    return { active: true, delta: Math.round(delta / 1000) };
  }

  // Otherwise write the state of the event with current timestamp and save to bucket
  eventStates[id] = { created: timeNow };
  await storage
    .bucket(config.gcs.bucketName)
    .file(`states/${id}_state.json`)
    .save(JSON.stringify(eventStates, null, ' '), {
      metadata: { contentType: 'application/json' },
    });
  return { active: false };
}

/**
 * The Cloud Function. Triggers on a Pub/Sub trigger, audits the URLs in config.json, writes the result in GCS and loads the data into BigQuery.
 *
 * @param {object} event Trigger object.
 * @param {function} callback Callback function (not provided).
 * @returns {Promise<*>} Promise when BigQuery load starts.
 */
async function lighthouse_desktop_afa(event, callback) {
  try {
    log('Lighthouse for Desktop launched');

    const source = config.source;
    const msg = Buffer.from(event.data, 'base64').toString();
    const ids = source.map((obj) => obj.id);
    const uuid = uuidv1();
    const metadata = {
      sourceFormat: 'NEWLINE_DELIMITED_JSON',
      schema: { fields: bqSchema },
      jobId: uuid,
    };

    // If the Pub/Sub message is not valid
    if (msg !== 'all' && !ids.includes(msg)) {
      return console.error('No valid message found!');
    }

    if (msg === 'all') {
      return sendAllPubsubMsgs(ids);
    }

    const [src] = source.filter((obj) => obj.id === msg);
    const id = src.id;
    const url = src.url;

    log(`${id}: Received message to start with URL ${url}`);

    const timeNow = new Date().getTime();
    const eventState = await checkEventState(id, timeNow);
    if (eventState.active) {
      return log(
        `${id}: Found active event (${Math.round(
          eventState.delta
        )}s < ${Math.round(
          config.minTimeBetweenTriggers / 1000
        )}s), aborting...`
      );
    }

    const res = await launchBrowserWithLighthouse(id, url);

    await writeLogAndReportsToStorage(res, id);
    const json = createJSON(res.lhr, id);

    json.job_id = uuid;

    await writeFile(`/tmp/${uuid}.json`, toNdjson(json));

    await writeJsonResult(toNdjson(json), id);

    log(`${id}: BigQuery job with ID ${uuid} starting for ${url}`);

    return bigquery
      .dataset(config.datasetId)
      .table('reporting')
      .load(`/tmp/${uuid}.json`, metadata);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Initialization function - only run when Cloud Function is deployed and/or a new instance is started. Validates the configuration file against its schema.
 */
function init() {
  // Validate config schema
  const result = validator.validate(config, configSchema);
  if (result.errors.length) {
    throw new Error(
      `Error(s) in configuration file: ${JSON.stringify(
        result.errors,
        null,
        ' '
      )}`
    );
  } else {
    log(`Configuration validated successfully`);
  }
}

if (process.env.NODE_ENV !== 'test') {
  init();
} else {
  // For testing
  module.exports = {
    _init: init,
    _writeLogAndReportsToStorage: writeLogAndReportsToStorage,
    _sendAllPubSubMsgs: sendAllPubsubMsgs,
    _toNdJson: toNdjson,
    _createJSON: createJSON,
    _launchBrowserWithLighthouse: launchBrowserWithLighthouse,
    _checkEventState: checkEventState,
  };
}

module.exports.lighthouse_desktop_afa = lighthouse_desktop_afa;
