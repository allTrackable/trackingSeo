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
 const {URL} = require(`url`);
 const fs = require(`fs`);
 const {promisify} = require(`util`);

 const puppeteer = require(`puppeteer`);
 const lighthouse = require(`lighthouse`);
 const uuidv1 = require(`uuid/v1`);
 const {Validator} = require(`jsonschema`);

 const {BigQuery} = require(`@google-cloud/bigquery`);
 const {PubSub} = require(`@google-cloud/pubsub`);
 const {Storage} = require(`@google-cloud/storage`);

 const bqSchema = require(`./bigquery-schema.json`);
 const config = require(`./config.json`);
 const configSchema = require(`./config.schema.json`);

 // Make filesystem write work with async/await
 const writeFile = promisify(fs.writeFile);
 const readFile = promisify(fs.readFile);

 // Initialize new GC clients
 const bigquery = new BigQuery({
   projectId: config.projectId
 });
 const pubsub = new PubSub({
   projectId: config.projectId
 });
 const storage = new Storage({
   projectId: config.projectId
 });

 const validator = new Validator;

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

   const browser = await puppeteer.launch({args: ['--no-sandbox']});

   log(`${id}: Browser started for ${url}`);

   config.lighthouseFlags = config.lighthouseFlags || {};

   config.lighthouseFlags.port = (new URL(browser.wsEndpoint())).port;

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
     accessibility: [{
       total_score: obj.categories.accessibility.score,
       bypass_repetitive_content: obj.audits.bypass.score === 1,
       color_contrast: obj.audits['color-contrast'].score === 1,
       document_title_found: obj.audits['document-title'].score === 1,
       no_duplicate_id_attribute: obj.audits['duplicate-id'].score === 1,
       html_has_lang_attribute: obj.audits['html-has-lang'].score === 1,
       html_lang_is_valid: obj.audits['html-lang-valid'].score === 1,
       images_have_alt_attribute: obj.audits['image-alt'].score === 1
     }],
     best_practices: [{
       total_score: obj.categories['best-practices'].score,
       uses_https: obj.audits['is-on-https'].score === 1,
       uses_http2: obj.audits['uses-http2'].score === 1,
       uses_passive_event_listeners: obj.audits['uses-passive-event-listeners'].score === 1,
       no_document_write: obj.audits['no-document-write'].score === 1,
       external_anchors_use_rel_noopener: obj.audits['external-anchors-use-rel-noopener'].score === 1,
       no_geolocation_on_start: obj.audits['geolocation-on-start'].score === 1,
       doctype_defined: obj.audits.doctype.score === 1,
       no_vulnerable_libraries: obj.audits['no-vulnerable-libraries'].score === 1,
       notification_asked_on_start: obj.audits['notification-on-start'].score === 1,
       avoid_deprecated_apis: obj.audits.deprecations.score === 1,
       allow_paste_to_password_field: obj.audits['password-inputs-can-be-pasted-into'].score === 1,
       errors_in_console: obj.audits['errors-in-console'].score === 1,
       images_have_correct_aspect_ratio: obj.audits['image-aspect-ratio'].score === 1
     }],
     opportunities:[{
      server_response_time: [{
        id: obj.audits['server-response-time'].identifier,
        title: obj.audits['server-response-time'].title,
        description: obj.audits['server-response-time'].description,
        score: obj.audits['server-response-time'].score,
        numericValue: obj.audits['server-response-time'].numericValue,
        numericUnit: obj.audits['server-response-time'].numericUnit,
        displayValue: obj.audits['server-response-time'].displayValue,
        details:
        [{
            type: obj.audits['server-response-time'].type,
            headings:
              [{
              key: obj.audits['server-response-time'].key,
              valueType: obj.audits['server-response-time'].valueType,
              label: obj.audits['server-response-time'].label
              }],
        }],
               items:
               [
                 {
                 url: obj.audits['render-blocking-resources'].url,
                 totalBytes: obj.audits['render-blocking-resources'].totalBytes,
                 wastedMs: obj.audits['render-blocking-resources'].wastedMs
                 },
                 {
               overallSavingsMs: obj.audits['render-blocking-resources'].overallSavingsMs
                 }
               ],
        }
      ],

      redirects:[{
        id: obj.audits.redirects.identifier,
        title: obj.audits.redirects.title,
        description: obj.audits.redirects.description,
        score: obj.audits.redirects.score,
        numericValue: obj.audits.redirects.numericValue,
        numericUnit: obj.audits.redirects.numericUnit,
        displayValue: obj.audits.redirects.displayValue,
        details:
            [{
            type: obj.audits.redirects.type,
            headings: obj.audits.redirects.headings,
            items: obj.audits.redirects.items,
            overallSavingsMs: obj.audits.redirects.overallSavingsMs
            }],
        }
      ],

      uses_rel_preload: [{
        id: obj.audits['uses-rel-preload'].identifier,
        title: obj.audits['uses-rel-preload'].title,
        description: obj.audits['uses-rel-preload'].description,
        score: obj.audits['uses-rel-preload'].score,
        details:
          [{
          type: obj.audits['uses-rel-preload'].type,
          headings: obj.audits['uses-rel-preload'].headings,
          items: obj.audits['uses-rel-preload'].items,
          overallSavingsMs: obj.audits['uses-rel-preload'].overallSavingsMs
          }],
        }
      ],

      preload_lcp_image: [{
        id: obj.audits['preload-lcp-image'].identifier,
        title: obj.audits['preload-lcp-image'].title,
        description: obj.audits['preload-lcp-image'].description,
        score: obj.audits['preload-lcp-image'].score,
        numericValue: obj.audits['preload-lcp-image'].numericValue,
        numericUnit: obj.audits['preload-lcp-image'].numericUnit,
        displayValue: obj.audits['preload-lcp-image'].displayValue,
        details:
          [{
          type: obj.audits['preload-lcp-image'].type,
          headings:
            [
              {
             key: obj.audits['preload-lcp-image'].key,
             valueType: obj.audits['preload-lcp-image'].valueType,
             label: obj.audits['preload-lcp-image'].label
             },
             {
             key: obj.audits['preload-lcp-image'].key,
             valueType: obj.audits['preload-lcp-image'].valueType,
             label: obj.audits['preload-lcp-image'].label
            },
            {
            key: obj.audits['preload-lcp-image'].key,
            valueType: obj.audits['preload-lcp-image'].valueType,
            label: obj.audits['preload-lcp-image'].label
            }
          ],
          }],
        }
      ],

      offscreen_images: [{
        id: obj.audits['offscreen-images'].identifier,
        title: obj.audits['offscreen-images'].title,
        description: obj.audits['offscreen-images'].description,
        score: obj.audits['offscreen-images'].score,
        details:
          [{
          type: obj.audits['offscreen-images'].type,
          headings: obj.audits['offscreen-images'].headings,
          items: obj.audits['offscreen-images'].items,
          overallSavingsMs: obj.audits['offscreen-images'].overallSavingsMs,
          overallSavingsBytes: obj.audits['offscreen_images'].overallSavingsBytes
          }],
        }
      ],

      render_blocking_resources: [{
        id: obj.audits['render-blocking-resources'].identifier,
        title: obj.audits['render-blocking-resources'].title,
        description: obj.audits['render-blocking-resources'].description,
        score: obj.audits['render-blocking-resources'].score,
        numericValue: obj.audits['render-blocking-resources'].numericValue,
        numericUnit: obj.audits['render-blocking-resources'].numericUnit,
        details:
         [{
         type: obj.audits['render-blocking-resources'].type,
         headings:
                [
                  {
                  key: obj.audits['render-blocking-resources'].key,
                  valueType: obj.audits['render-blocking-resources'].valueType,
                  label: obj.audits['render-blocking-resources'].label
                  },
                  {
                  key: obj.audits['render-blocking-resources'].key,
                  valueType: obj.audits['render-blocking-resources'].valueType,
                  label: obj.audits['render-blocking-resources'].label
                  },
                  {
                  key: obj.audits['render-blocking-resources'].key,
                  valueType: obj.audits['render-blocking-resources'].valueType,
                  label: obj.audits['render-blocking-resources'].label
                  }
                ],
         }],
                  items:
                  [
                    {
                    url: obj.audits['render-blocking-resources'].url,
                    totalBytes: obj.audits['render-blocking-resources'].totalBytes,
                    wastedMs: obj.audits['render-blocking-resources'].wastedMs
                    },
                    {
                    overallSavingsMs: obj.audits['render-blocking-resources'].overallSavingsMs
                    }
                  ],
       }
      ],

        unminified_css: [{
          id: obj.audits['unminified-css'].identifier,
          title: obj.audits['unminified-css'].title,
          description: obj.audits['unminified-css'].description,
          score: obj.audits['unminified-css'].score,
          numericValue: obj.audits['unminified-css'].numericValue,
          numericUnit: obj.audits['unminified-css'].numericUnit,
          displayValue: obj.audits['unminified-css'].displayValue,
          details:
          [
              {
              type: obj.audits['unminified-css'].type,
              headings: obj.audits['unminified-css'].headings,
              items: obj.audits['unminified-css'].items,
              overallSavingsMs: obj.audits['unminified-css'].overallSavingsMs,
              overallSavingsBytes: obj.audits['unminified-css'].overallSavingsBytes
              }
          ],
        }
      ],

        unminified_javascript:[{
          id: obj.audits['unminified-javascript'].identifier,
          title: obj.audits['unminified-javascript'].title,
          description: obj.audits['unminified-javascript'].description,
          score: obj.audits['unminified-javascript'].score,
          numericValue: obj.audits['unminified-javascript'].numericValue,
          numericUnit: obj.audits['unminified-javascript'].numericUnit,
          displayValue: obj.audits['unminified-javascript'].displayValue,
          details:
          [
                {
                type: obj.audits['unminified-javascript'].type,
                headings: obj.audits['unminified-javascript'].headings,
                items: obj.audits['unminified-javascript'].items,
                overallSavingsMs: obj.audits['unminified-javascript'].overallSavingsMs,
                overallSavingsBytes: obj.audits['unminified-javascript'].overallSavingsBytes
                }
          ],
        }
      ],

        unused_css_rules:[{
          id: obj.audits['unused-css-rules'].identifier,
          title: obj.audits['unused-css-rules'].title,
          description: obj.audits['unused-css-rules'].description,
          score: obj.audits['unused-css-rules'].score,
          numericValue: obj.audits['unused-css-rules'].numericValue,
          numericUnit: obj.audits['unused-css-rules'].numericUnit,
          details:
          [
            {
            type: obj.audits['unused-css-rules'].type,
            headings:
            [
               {
               key: obj.audits['unused-css-rules'].key,
               valueType: obj.audits['unused-css-rules'].valueType,
               label: obj.audits['unused-css-rules'].label
               },
               {
               key: obj.audits['unused-css-rules'].key,
               valueType: obj.audits['unused-css-rules'].valueType,
               label: obj.audits['unused-css-rules'].label
               },
               {
               key: obj.audits['unused-css-rules'].key,
               valueType: obj.audits['unused-css-rules'].valueType,
               label: obj.audits['unused-css-rules'].label
               }
            ],
            }
          ],

      unused_javascript: [{
        id: obj.audits['unused-javascript'].identifier,
        title: obj.audits['unused-javascript'].title,
        description: obj.audits['unused-cjavascript'].description,
        score: obj.audits['unused-javascript'].score,
        numericValue: obj.audits['unused-javascript'].numericValue,
        numericUnit: obj.audits['unused-javascript'].numericUnit,
        details:
        [
          {
          type: obj.audits['unused-javascript'].type,
          headings:
          [
             {
             key: obj.audits['unused-javascript'].key,
             valueType: obj.audits['unused-javascript'].valueType,
              subItemsHeading:
                {
                key: obj.audits['unused-javascript'].key,
                valueType: obj.audits['unused-javascript'].valueType
                }
              },
            {
            label: obj.audits['unused-javascript'].label
            },
          {
            key: obj.audits['unused-javascript'].key,
            valueType: obj.audits['unused-javascript'].valueType,
             subItemsHeading:
               {
               key: obj.audits['unused-javascript'].key
               }
          },
           {
           label: obj.audits['unused-javascript'].label
           },
            {
            key: obj.audits['unused-javascript'].key,
            valueType: obj.audits['unused-javascript'].valueType,
             subItemsHeading:
             {
               key: obj.audits['unused-javascript'].key
             }
            }
          ],
       }
     ],

    modern_image_formats: [{
        id: obj.audits['modern-image-formats'].identifier,
        title: obj.audits['modern-image-formats'].title,
        description: obj.audits['modern-image-formats'].description,
        score: obj.audits['modern-image-formats'].score,
        numericValue: obj.audits['modern-image-formats'].numericValue,
        numericUnit: obj.audits['modern-image-formats'].numericUnit,
        warnings: obj.audits['modern-image-formats'].warnings,
        details:
         [{
         type: obj.audits['modern-image-formats'].type,
         headings:
                [
                  {
                  key: obj.audits['modern-image-formats'].key,
                  valueType: obj.audits['modern-image-formats'].valueType,
                  label: obj.audits['modern-image-formats'].label
                  },
                  {
                  key: obj.audits['modern-image-formats'].key,
                  valueType: obj.audits['modern-image-formats'].valueType,
                  label: obj.audits['modern-image-formats'].label
                  },
                  {
                  key: obj.audits['modern-image-formats'].key,
                  valueType: obj.audits['modern-image-formats'].valueType,
                  label: obj.audits['modern-image-formats'].label
                  },
                  {
                  key: obj.audits['modern-image-formats'].key,
                  valueType: obj.audits['modern-image-formats'].valueType,
                  label: obj.audits['modern-image-formats'].label
                  }
                ],
         }],
                  items:
                  [
                    {
                    url: obj.audits['modern-image-formats'].url,
                    fromProtocol: obj.audits['modern-image-formats'].fromProtocol,
                    isCrossOrigin: obj.audits['modern-image-formats'].isCrossOrigin,
                    totalBytes: obj.audits['modern-image-formats'].totalBytes,
                    wastedBytes: obj.audits['modern-image-formats'].wastedBytes,
                    wastedWebpBytes: obj.audits['modern-image-formats'].wastedWebpBytes
                    },
                    {
                    overallSavingsMs: obj.audits['modern-image-formats'].overallSavingsMs,
                    overallSavingsBytes: obj.audits['modern-image-formats'].overallSavingsBytes
                    }
                  ],
      }
    ],

    uses_optimized_images:
    [
      {
        id: obj.audits['uses-optimized-images'].identifier,
        title: obj.audits['uses-optimized-images'].title,
        description: obj.audits['uses-optimized-images'].description,
        score: obj.audits['uses-optimized-images'].score,
        numericValue: obj.audits['uses-optimized-images'].numericValue,
        numericUnit: obj.audits['uses-optimized-images'].numericUnit,
        warnings: obj.audits['uses-optimized-images'].warnings,
        details:
         [
           {
           type: obj.audits['uses-optimized-images'].type,
           headings: obj.audits['uses-optimized-images'].headings,
           items: obj.audits['uses-optimized-images'].items,
           overallSavingsMs: obj.audits['uses-optimized-images'].overallSavingsMs,
           overallSavingsBytes: obj.audits['uses-optimized-images'].overallSavingsBytes
           }
        ],
      }
    ],

  uses_text_compression: [{
    id: obj.audits['uses-text-compression'].identifier,
    title: obj.audits['uses-text-compression'].title,
    description: obj.audits['uses-text-compression'].description,
    score: obj.audits['uses-text-compression'].score,
    numericValue: obj.audits['uses-text-compression'].numericValue,
    numericUnit: obj.audits['uses-text-compression'].numericUnit,
    displayValue: obj.audits['uses-text-compression'].displayValue,
    details:
     [{
     type: obj.audits['uses-text-compression'].type,
     headings:
            [
              {
              key: obj.audits['uses-text-compression'].key,
              valueType: obj.audits['uses-text-compression'].valueType,
              label: obj.audits['uses-text-compression'].label
              },
              {
              key: obj.audits['uses-text-compression'].key,
              valueType: obj.audits['uses-text-compression'].valueType,
              label: obj.audits['uses-text-compression'].label
              },
              {
              key: obj.audits['uses-text-compression'].key,
              valueType: obj.audits['uses-text-compression'].valueType,
              label: obj.audits['uses-text-compression'].label
              }
            ],
     }],
              items:
              [
                {
                url: obj.audits['uses-text-compression'].url,
                totalBytes: obj.audits['uses-text-compression'].totalBytes,
                wastedMs: obj.audits['uses-text-compression'].wastedMs
                },
                {
                overallSavingsMs: obj.audits['uses-text-compression'].overallSavingsMs,
                overallSavingsBytes: obj.audits['uses-text-compression'].overallSavingsBytes
                }
              ],
   }
  ],


     performance: [{
       total_score: obj.categories.performance.score,
       first_contentful_paint: [{
         rawValue: obj.audits['first-contentful-paint'].rawValue,
         score: obj.audits['first-contentful-paint'].score
       }],
       first_meaningful_paint: [{
         rawValue: obj.audits['first-meaningful-paint'].rawValue,
         score: obj.audits['first-meaningful-paint'].score
       }],
       speed_index: [{
         rawValue: obj.audits['speed-index'].rawValue,
         score: obj.audits['speed-index'].score
       }],
       interactive: [{
         rawValue: obj.audits.interactive.rawValue,
         score: obj.audits.interactive.score
       }],
       first_cpu_idle: [{
         rawValue: obj.audits['first-cpu-idle'].rawValue,
         score: obj.audits['first-cpu-idle'].score
       }]
     }],
     pwa: [{
       total_score: obj.categories.pwa.score,
       load_fast_enough: obj.audits['load-fast-enough-for-pwa'].score === 1,
       works_offline: obj.audits['works-offline'].score === 1,
       installable_manifest: obj.audits['installable-manifest'].score === 1,
       uses_https: obj.audits['is-on-https'].score === 1,
       redirects_http_to_https: obj.audits['redirects-http'].score === 1,
       has_meta_viewport: obj.audits.viewport.score === 1,
       uses_service_worker: obj.audits['service-worker'].score === 1,
       works_without_javascript: obj.audits['without-javascript'].score === 1,
       splash_screen_found: obj.audits['splash-screen'].score === 1
     }],
     seo: [{
       total_score: obj.categories.seo.score,
       has_meta_viewport: obj.audits.viewport.score === 1,
       document_title_found: obj.audits['document-title'].score === 1,
       meta_description: obj.audits['meta-description'].score === 1,
       http_status_code: obj.audits['http-status-code'].score === 1,
       descriptive_link_text: obj.audits['link-text'].score === 1,
       is_crawlable: obj.audits['is-crawlable'].score === 1,
       robots_txt_valid: obj.audits['robots-txt'].score === 1,
       hreflang_valid: obj.audits.hreflang.score === 1,
       font_size_ok: obj.audits['font-size'].score === 1,
       plugins_ok: obj.audits.plugins.score === 1
     }]
   }


 /**
  * Converts input object to newline-delimited JSON
  *
  * @param {object} data Object to convert.
  * @returns {string} The stringified object.
  */,
 function toNdjson(data) {
   data = Array.isArray(data) ? data : [data];
   let outNdjson = '';
   data.forEach(item => {
     outNdjson += JSON.stringify(item) + '\n';
   });
   return outNdjson;
 }

 /**
  * Publishes a message to the Pub/Sub topic for every ID in config.json source object.
  *
  * @param {array<string>} ids Array of ids to publish into Pub/Sub.
  * @returns {Promise<any[]>} Resolved promise when all IDs have been published.
  */,
 async function sendAllPubsubMsgs(ids) {
   return await Promise.all(ids.map(async (id) => {
     const msg = Buffer.from(id);
     log(`${id}: Sending init PubSub message`);
     await pubsub
       .topic(config.pubsubTopicId)
       .publisher()
       .publish(msg);
     log(`${id}: Init PubSub message sent`)
   }));
 }

 /**
  * Write the lhr log object and reports to GCS. Only write reports if lighthouseFlags.output is defined in config.json.
  *
  * @param {object} obj The lighthouse audit object.
  * @param {string} id ID of the source.
  * @returns {Promise<void>} Resolved promise when all write operations are complete.
  */,
 async function writeLogAndReportsToStorage(obj, id) {
   const bucket = storage.bucket(config.gcs.bucketName);
   config.lighthouseFlags.output = config.lighthouseFlags.output || [];
   await Promise.all(config.lighthouseFlags.output.map(async (fileType, idx) => {
  //let filePath = `${id}/report_${obj.lhr.fetchTime}`;
    let filePath = `${id}_report_${obj.lhr.fetchTime}`;
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
        log(`${id}: Writing ${fileType} report to bucket ${config.gcs.bucketName}`);
        return await file.save(obj.report[idx], {
          metadata: {contentType: mimetype}
        });
      }));


  //    const file = bucket.file(`${id}_log_${obj.lhr.fetchTime}.json`);
  //    log(`${id}: Writing log to bucket ${config.gcs.bucketName}`);
  //    return await file.save(JSON.stringify(obj.lhr, null, " "), {
  //      metadata: {contentType: 'application/json'}
  //    });
    },


    // Custom function
    async function writeJsonResult(json, id){

      const bucket = storage.bucket(config.gcs.bucketName);
      config.lighthouseFlags.output = config.lighthouseFlags.output || [];
      const file = bucket.file(`results/${id}_output.json`);

      log(`${id}: Writing OUTPUT to bucket ${config.gcs.bucketName}`);
      return await file.save(json, {
        metadata: {contentType: 'application/json'}

      });

    }
 /**
  * Check events in GCS states.json to see if an event with given ID has been pushed to Pub/Sub less than
  * minTimeBetweenTriggers (in config.json) ago.
  *
  * @param {string} id ID of the source (and the Pub/Sub message).
  * @param {number} timeNow Timestamp when this method was invoked.
  * @returns {Promise<object>} Object describing active state and time delta between invocation and when the state entry was created, if necessary.
  */,
 async function checkEventState(id, timeNow) {
   let eventStates = {};
   try {
     // Try to load existing state file from storage
     const destination = `/tmp/state_${id}.json`;
     await storage
       .bucket(config.gcs.bucketName)
       .file(`${id}_state.json`)
       //.file(`state_${id}json`)
       .download({destination: destination});
     eventStates = JSON.parse(await readFile(destination));
   } catch(e) {}

   // Check if event corresponding to id has been triggered less than the timeout ago
   const delta = id in eventStates && (timeNow - eventStates[id].created);
   if (delta && delta < config.minTimeBetweenTriggers) {
     return {active: true, delta: Math.round(delta/1000)}
   }

   // Otherwise write the state of the event with current timestamp and save to bucket
   eventStates[id] = {created: timeNow};
   await storage.bucket(config.gcs.bucketName).file(`${id}_state.json`).save(JSON.stringify(eventStates, null, " "), {
     metadata: {contentType: 'application/json'}
   });
   return {active: false}
 }

 /**
  * The Cloud Function. Triggers on a Pub/Sub trigger, audits the URLs in config.json, writes the result in GCS and loads the data into BigQuery.
  *
  * @param {object} event Trigger object.
  * @param {function} callback Callback function (not provided).
  * @returns {Promise<*>} Promise when BigQuery load starts.
  */,
 async function launchLighthouse (event, callback) {
   try {
     log("This is a message.");

     const source = config.source;
     const msg = Buffer.from(event.data, 'base64').toString();
     const ids = source.map(obj => obj.id);
     const uuid = uuidv1();
     const metadata = {
       sourceFormat: 'NEWLINE_DELIMITED_JSON',
       schema: {fields: bqSchema},
       jobId: uuid
     };

     // If the Pub/Sub message is not valid
     if (msg !== 'all' && !ids.includes(msg)) { return console.error('No valid message found!'); }

     if (msg === 'all') { return sendAllPubsubMsgs(ids); }

     const [src] = source.filter(obj => obj.id === msg);
     const id = src.id;
     const url = src.url;

     log(`${id}: Received message to start with URL ${url}`);

     const timeNow = new Date().getTime();
     const eventState = await checkEventState(id, timeNow);
     if (eventState.active) {
       return log(`${id}: Found active event (${Math.round(eventState.delta)}s < ${Math.round(config.minTimeBetweenTriggers/1000)}s), aborting...`);
     }

     const res = await launchBrowserWithLighthouse(id, url);

     await writeLogAndReportsToStorage(res, id);
     const json = createJSON(res.lhr, id);

     json.job_id = uuid;

     await writeFile(`/tmp/${uuid}.json`, toNdjson(json));

     await writeJsonResult(toNdjson(json),id);

     log(`${id}: BigQuery job with ID ${uuid} starting for ${url}`);

     return bigquery
       .dataset(config.datasetId)
       .table('reporting')
       .load(`/tmp/${uuid}.json`, metadata);

   } catch(e) {
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
     throw new Error(`Error(s) in configuration file: ${JSON.stringify(result.errors, null, " ")}`);
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
     _checkEventState: checkEventState
   }
 }
 
 module.exports.launchLighthouse = launchLighthouse;
