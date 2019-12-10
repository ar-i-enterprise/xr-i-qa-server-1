import AgoraRTC from "agora-rtc-sdk";
import "bulma";
import $ from "jquery";
import * as Cookies from "js-cookie";
import { merge } from "lodash";
import "@/assets/css/icons.css";

import "@/assets/global.scss";
import "./meeting.scss";
import ButtonControl from "@/utils/ButtonControl";
import {
  isSafari,
  isMobileSize,
  isChrome,
  isFirefox
} from "@/utils/BrowserCheck";
import Notify from "@/utils/Notify";
import Renderer from "@/utils/Render";
import { SHARE_ID, RESOLUTION_ARR, APP_ID, Token } from "@/utils/Settings";
import { logger, log } from "../../utils/Logger";
// eslint-disable-next-line
import Polyfill from "@/utils/Polyfill";

// If display a window to show video info
const DUAL_STREAM_DEBUG = false;
let options = {};
let client = {};
let localStream = {};
let streamList = [];
let shareClient = null;
let shareStream = null;
let mainId;
let mainStream;

const globalLog = logger.init("global", "blue");
const shareLog = logger.init("share", "yellow");
const localLog = logger.init("local", "green");

const optionsInit = () => {
  let options = {
    videoProfile: Cookies.get("videoProfile").split(",")[0] || "480p_4",
    videoProfileLow: Cookies.get("videoProfileLow"),
    cameraId: Cookies.get("cameraId"),
    microphoneId: Cookies.get("microphoneId"),
    channel: Cookies.get("channel") || "test",
    transcode: Cookies.get("transcode") || "interop",
    attendeeMode: Cookies.get("attendeeMode") || "video",
    baseMode: Cookies.get("baseMode") || "avc",
    displayMode: 1, // 0 Tile, 1 PIP, 2 screen share
    uid: undefined, // In default it is dynamically generated
    resolution: undefined
  };

  let tempProfile = RESOLUTION_ARR[Cookies.get("videoProfile")];
  options.resolution = tempProfile[0] / tempProfile[1] || 4 / 3;

  options.key = APP_ID;
  options.token = Token;

  return options;
};

const uiInit = options => {
  document.querySelector(
    ".ag-header-lead span"
  ).innerHTML = `XR-I QA Server v${agoraVersion.slice(1)}`;
  Renderer.init("ag-canvas", 9 / 16, 8 / 5);
  // Mobile page should remove title and footer
  if (isMobileSize()) {
    Renderer.enterFullScreen();
  }
  // Only firefox and chrome support screen sharing
  if (!isFirefox() && !isChrome()) {
    ButtonControl.disable(".shareScreenBtn");
  }

  $("#room-name").html(options.channel);
  switch (options.attendeeMode) {
    case "audio-only":
      ButtonControl.hide([".videoControlBtn", ".shareScreenBtn"]);
      break;
    case "audience":
      ButtonControl.hide([
        ".videoControlBtn",
        ".audioControlBtn",
        ".shareScreenBtn"
      ]);
      break;
    default:
    case "video":
      break;
  }
};

const clientInit = (client, options) => {
  return new Promise((resolve, reject) => {
    client.init(options.key, () => {
      globalLog("AgoraRTC client initialized");
      let lowStreamParam = RESOLUTION_ARR[options.videoProfileLow];
      client.join(
        options.token,
        options.channel,
        options.uid,
        uid => {
          log(uid, "brown", `User ${uid} join channel successfully`);
          log(uid, "brown", new Date().toLocaleTimeString());
          client.setLowStreamParameter({
            width: lowStreamParam[0],
            height: lowStreamParam[1],
            framerate: lowStreamParam[2],
            bitrate: lowStreamParam[3]
          });
          // Create localstream
          resolve(uid);
        },
        err => {
          reject(err);
        }
      );
    });
  });
};

/**
 *
 * @param {*} uid
 * @param {*} options global option
 * @param {*} config stream config
 */
const streamInit = (uid, options, config) => {
  let defaultConfig = {
    streamID: uid,
    audio: true,
    video: true,
    screen: false
  };

  switch (options.attendeeMode) {
    case "audio-only":
      defaultConfig.video = false;
      break;
    case "audience":
      defaultConfig.video = false;
      defaultConfig.audio = false;
      break;
    default:
    case "video":
      break;
  }
  // eslint-disable-next-line
  let stream = AgoraRTC.createStream(merge(defaultConfig, config));
  stream.setVideoProfile(options.videoProfile);
  return stream;
};

const shareEnd = () => {
  try {
    shareClient && shareClient.unpublish(shareStream);
    shareStream && shareStream.close();
    shareClient &&
      shareClient.leave(
        () => {
          shareLog("Share client succeed to leave.");
        },
        () => {
          shareLog("Share client failed to leave.");
        }
      );
  } finally {
    shareClient = null;
    shareStream = null;
  }
};

const shareStart = () => {
  ButtonControl.disable(".shareScreenBtn");
  // eslint-disable-next-line
  shareClient = AgoraRTC.createClient({
    mode: options.transcode
  });
  let shareOptions = merge(options, {
    uid: SHARE_ID
  });
  clientInit(shareClient, shareOptions).then(uid => {
    let config = {
      screen: true,
      video: false,
      audio: false,
      extensionId: "minllpmhdgpndnkomcoccfekfegnlikg",
      mediaSource: "application"
    };
    shareStream = streamInit(uid, shareOptions, config);
    shareStream.init(
      () => {
        ButtonControl.enable(".shareScreenBtn");
        shareStream.on("stopScreenSharing", () => {
          shareEnd();
          shareLog("Stop Screen Sharing at" + new Date());
        });
        shareClient.publish(shareStream, err => {
          shareLog("Publish share stream error: " + err);
          shareLog("getUserMedia failed", err);
        });
      },
      err => {
        ButtonControl.enable(".shareScreenBtn");
        shareLog("getUserMedia failed", err);
        shareEnd();
        if (isChrome()) {
          // If (!chrome.app.isInstalled) {
          let msg = `
           "Share Screen Function is disabled !!!"I am working on this function. It will be implemented in the ner future  
          `;
          Notify.danger(msg, 5000);
          // }
        }
      }
    );
  });
};

window.installSuccess = (...args) => {
  globalLog(...args);
};

window.installError = (...args) => {
  globalLog(...args);
  Notify.danger(
    "Failed to install the extension, please check the network and console.",
    3000
  );
};

const removeStream = id => {
  streamList.map((item, index) => {
    if (item.getId() === id) {
      streamList[index].close();
      $("#video-item-" + id).remove();
      streamList.splice(index, 1);
      return 1;
    }
    return 0;
  });
  if (streamList.length <= 4 && options.displayMode !== 2) {
    ButtonControl.enable(".displayModeBtn");
  }
  Renderer.customRender(streamList, options.displayMode, mainId);
};
// my function--




const addStream = (stream, push = false) => {
  let id = stream.getId();
  // Check for redundant
  let redundant = streamList.some(item => {
    return item.getId() === id;
  });
  if (redundant) {
    return;
  }
  // Do push for localStream and unshift for other streams
  push ? streamList.push(stream) : streamList.unshift(stream);
  if (streamList.length > 4) {
    options.displayMode = options.displayMode === 1 ? 0 : options.displayMode;
    ButtonControl.disable([".displayModeBtn", ".disableRemoteBtn"]);
  }
  Renderer.customRender(streamList, options.displayMode, mainId);
};

const getStreamById = id => {
  return streamList.filter(item => {
    return item.getId() === id;
  })[0];
};

const enableDualStream = () => {
  client.enableDualStream(
    function() {
      localLog("Enable dual stream success!");
    },
    function(e) {
      localLog(e);
    }
  );
};

const setHighStream = (prev, next) => {
  if (prev === next) {
    return;
  }
  let prevStream;
  let nextStream;
  // Get stream by id
  for (let stream of streamList) {
    let id = stream.getId();
    if (id === prev) {
      prevStream = stream;
    } else if (id === next) {
      nextStream = stream;
    } else {
      // Do nothing
    }
  }
  // Set prev stream to low
  prevStream && client.setRemoteVideoStreamType(prevStream, 1);
  // Set next stream to high
  nextStream && client.setRemoteVideoStreamType(nextStream, 0);
};
/**
 * Add callback for client event to control streams
 * @param {*} client
 * @param {*} streamList
 */
const subscribeStreamEvents = () => {
  client.on("stream-added", function(evt) {
    let stream = evt.stream;
    let id = stream.getId();
    localLog("New stream added: " + id);
    localLog(new Date().toLocaleTimeString());
    localLog("Subscribe ", stream);
    if (id === SHARE_ID) {
      options.displayMode = 2;
      mainId = id;
      mainStream = stream;
      if (!shareClient) {
        ButtonControl.disable(".shareScreenBtn");
      }
      ButtonControl.disable([".displayModeBtn", ".disableRemoteBtn"]);
    }
    if (id !== mainId) {
      if (options.displayMode === 2) {
        client.setRemoteVideoStreamType(stream, 1);
      } else {
        mainStream && client.setRemoteVideoStreamType(mainStream, 1);
        mainStream = stream;
        mainId = id;
      }
    }
    client.subscribe(stream, function(err) {
      localLog("Subscribe stream failed", err);
    });
  });

  client.on("peer-leave", function(evt) {
    let id = evt.uid;
    localLog("Peer has left: " + id);
    localLog(new Date().toLocaleTimeString());
    if (id === SHARE_ID) {
      options.displayMode = 0;
      if (options.attendeeMode === "video") {
        ButtonControl.enable(".shareScreenBtn");
      }
      ButtonControl.enable([".displayModeBtn", ".disableRemoteBtn"]);
      shareEnd();
    }
    if (id === mainId) {
      let next = options.displayMode === 2 ? SHARE_ID : localStream.getId();
      setHighStream(mainId, next);
      mainId = next;
      mainStream = getStreamById(mainId);
    }
    removeStream(evt.uid);
  });

  client.on("stream-subscribed", function(evt) {
    let stream = evt.stream;
    localLog("Got stream-subscribed event");
    localLog(new Date().toLocaleTimeString());
    localLog("Subscribe remote stream successfully: " + stream.getId());
    addStream(stream);
  });

  client.on("stream-removed", function(evt) {
    let stream = evt.stream;
    let id = stream.getId();
    localLog("Stream removed: " + id);
    localLog(new Date().toLocaleTimeString());
    if (id === SHARE_ID) {
      options.displayMode = 0;
      if (options.attendeeMode === "video") {
        ButtonControl.enable(".shareScreenBtn");
      }
      ButtonControl.enable([".displayModeBtn", ".disableRemoteBtn"]);
      shareEnd();
    }
    if (id === mainId) {
      let next = options.displayMode === 2 ? SHARE_ID : localStream.getId();
      setHighStream(mainId, next);
      mainId = next;
      mainStream = getStreamById(mainId);
    }
    removeStream(stream.getId());
  });
};

const subscribeMouseEvents = () => {
  $(".displayModeBtn").on("click", function(e) {
    if (
      e.currentTarget.classList.contains("disabled") ||
      streamList.length <= 1
    ) {
      return;
    }
    // 1 refer to pip mode
    if (options.displayMode === 1) {
      options.displayMode = 0;
      ButtonControl.disable(".disableRemoteBtn");
    } else if (options.displayMode === 0) {
      options.displayMode = 1;
      ButtonControl.enable(".disableRemoteBtn");
    } else {
      // Do nothing when in screen share mode
    }
    Renderer.customRender(streamList, options.displayMode, mainId);
  });

  $(".exitBtn").on("click", function() {
    try {
      shareClient && shareEnd();
      client && client.unpublish(localStream);
      localStream && localStream.close();
      client &&
        client.leave(
          () => {
            localLog("Client succeed to leave.");
          },
          () => {
            localLog("Client failed to leave.");
          }
        );
    } finally {
      // Redirect to index
      window.location.href = "index.html";
    }
  });

  $(".videoControlBtn").on("click", function() {
    $(".videoControlBtn").toggleClass("off");
    localStream.isVideoOn()
      ? localStream.disableVideo()
      : localStream.enableVideo();
  });

  $(".audioControlBtn").on("click", function() {
    $(".audioControlBtn").toggleClass("off");
    localStream.isAudioOn()
      ? localStream.disableAudio()
      : localStream.enableAudio();
  });

  $(".shareScreenBtn").on("click", function(e) {
    if (e.currentTarget.classList.contains("disabled")) {
      return;
    }
    if (shareClient) {
      shareEnd();
    } else {
      shareStart();
    }
  });

  $(".disableRemoteBtn").on("click", function(e) {
    if (
      e.currentTarget.classList.contains("disabled") ||
      streamList.length <= 1
    ) {
      return;
    }
    $(".disableRemoteBtn").toggleClass("off");
    let list;
    let id = localStream.getId();
    list = Array.from(
      document.querySelectorAll(`.video-item:not(#video-item-${id})`)
    );
    list.map(item => {
      if (item.style.display === "none") {
        item.style.display = "block";
        return 1;
      }
      item.style.display = "none";
      return 0;
    });
  });

  $(window).resize(function(_) {
    if (isMobileSize()) {
      Renderer.enterFullScreen();
    } else {
      Renderer.exitFullScreen();
    }
    Renderer.customRender(streamList, options.displayMode, mainId);
  });

  // Dbl click to switch high/low stream
  $(".ag-container").dblclick(function(e) {
    let dom = e.target;
    while (!dom.classList.contains("video-item")) {
      dom = dom.parentNode;
      if (dom.classList.contains("ag-main")) {
        return;
      }
    }
    let id = parseInt(dom.id.split("-")[2], 10);
    if (id !== mainId) {
      let next = options.displayMode === 2 ? SHARE_ID : id;
      // Force to swtich
      setHighStream(mainId, next);
      mainId = next;
      mainStream = getStreamById(mainId);
    }
    Renderer.customRender(streamList, options.displayMode, mainId);
  });

  $(document).mousemove(function(_) {
    if (global._toolbarToggle) {
      clearTimeout(global._toolbarToggle);
    }
    $(".ag-btn-group").addClass("active");
    global._toolbarToggle = setTimeout(function() {
      $(".ag-btn-group").removeClass("active");
    }, 2500);
  });
};

const infoDetectSchedule = () => {
  let no = streamList.length;
  for (let i = 0; i < no; i++) {
    let item = streamList[i];
    let id = item.getId();
    let box = $(`#video-item-${id} .video-item-box`);
    let width;
    let height;
    let frameRate;
    let HighOrLow;
    // Whether high or low stream
    if (id === mainId) {
      HighOrLow = "High";
    } else {
      HighOrLow = "Low";
    }
    if (i === no - 1) {
      HighOrLow = "local";
    }
    item.getStats(function(e) {
      if (i === no - 1) {
        width = e.videoSendResolutionWidth;
        height = e.videoSendResolutionHeight;
        frameRate = e.videoSendFrameRate;
      } else {
        width = e.videoReceivedResolutionWidth;
        height = e.videoReceivedResolutionHeight;
        frameRate = e.videoReceiveFrameRate;
      }

      let str = `
        <p>uid: ${id}</p>
        <p>${width}*${height} ${frameRate}fps</p>
        <p>${HighOrLow}</p>
      `;
      box.html(str);
    });
  }
};

// ------------- start --------------
// ----------------------------------
options = optionsInit();

uiInit(options);

// eslint-disable-next-line

client = AgoraRTC.createClient({
  mode: options.transcode
});

subscribeMouseEvents();

subscribeStreamEvents();

clientInit(client, options).then(uid => {
  // Use selected device
  let config = isSafari()
    ? {}
    : {
        cameraId: options.cameraId,
        microphoneId: options.microphoneId
      };
  localStream = streamInit(uid, options, config);

  // Enable dual stream
  if (options.attendeeMode !== "audience") {
    // MainId default to be localStream's ID
    mainId = uid;
    mainStream = localStream;
  }
  enableDualStream();
  localStream.init(
    () => {
      if (options.attendeeMode !== "audience") {
        addStream(localStream, true);
        client.publish(localStream, err => {
          localLog("Publish local stream error: " + err);
        });
      }
    },
    err => {
      localLog("getUserMedia failed", err);
    }
  );
});

if (DUAL_STREAM_DEBUG) {
  setInterval(infoDetectSchedule, 1000);
}
























import "babel-polyfill";
import * as tf from "@tensorflow/tfjs";
import * as tfd from "@tensorflow/tfjs-data";

import { ControllerDataset } from "./controller_dataset";
import * as ui from "./ui";

// The number of classes we want to predict. In this example, we will be
// predicting 4 classes for up, down, left, and right.
const NUM_CLASSES = 4;

// A webcam iterator that generates Tensors from the images from the webcam.
let webcam;

// The dataset object where we will store activations.
const controllerDataset = new ControllerDataset(NUM_CLASSES);

let truncatedMobileNet;
let model;

// Loads mobilenet and returns a model that returns the internal activation
// we'll use as input to our classifier model.
async function loadTruncatedMobileNet() {
  const mobilenet = await tf.loadLayersModel(
    "https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v1_0.25_224/model.json"
  );

  // Return a model that outputs an internal activation.
  const layer = mobilenet.getLayer("conv_pw_13_relu");
  return tf.model({ inputs: mobilenet.inputs, outputs: layer.output });
}

// When the UI buttons are pressed, read a frame from the webcam and associate
// it with the class label given by the button. up, down, left, right are
// labels 0, 1, 2, 3 respectively.
ui.setExampleHandler(async label => {
  let img = await getImage();

  controllerDataset.addExample(truncatedMobileNet.predict(img), label);

  // Draw the preview thumbnail.
  ui.drawThumb(img, label);
  img.dispose();
});

/**
 * Sets up and trains the classifier.
 */
async function train() {
  if (controllerDataset.xs == null) {
    throw new Error("Add some examples before training!");
  }

  // Creates a 2-layer fully connected model. By creating a separate model,
  // rather than adding layers to the mobilenet model, we "freeze" the weights
  // of the mobilenet model, and only train weights from the new model.
  model = tf.sequential({
    layers: [
      // Flattens the input to a vector so we can use it in a dense layer. While
      // technically a layer, this only performs a reshape (and has no training
      // parameters).
      tf.layers.flatten({
        inputShape: truncatedMobileNet.outputs[0].shape.slice(1)
      }),
      // Layer 1.
      tf.layers.dense({
        units: ui.getDenseUnits(),
        activation: "relu",
        kernelInitializer: "varianceScaling",
        useBias: true
      }),
      // Layer 2. The number of units of the last layer should correspond
      // to the number of classes we want to predict.
      tf.layers.dense({
        units: NUM_CLASSES,
        kernelInitializer: "varianceScaling",
        useBias: false,
        activation: "softmax"
      })
    ]
  });

  // Creates the optimizers which drives training of the model.
  const optimizer = tf.train.adam(ui.getLearningRate());
  // We use categoricalCrossentropy which is the loss function we use for
  // categorical classification which measures the error between our predicted
  // probability distribution over classes (probability that an input is of each
  // class), versus the label (100% probability in the true class)>
  model.compile({ optimizer: optimizer, loss: "categoricalCrossentropy" });

  // We parameterize batch size as a fraction of the entire dataset because the
  // number of examples that are collected depends on how many examples the user
  // collects. This allows us to have a flexible batch size.
  const batchSize = Math.floor(
    controllerDataset.xs.shape[0] * ui.getBatchSizeFraction()
  );
  if (!(batchSize > 0)) {
    throw new Error(
      `Batch size is 0 or NaN. Please choose a non-zero fraction.`
    );
  }

  // Train the model! Model.fit() will shuffle xs & ys so we don't have to.
  model.fit(controllerDataset.xs, controllerDataset.ys, {
    batchSize,
    epochs: ui.getEpochs(),
    callbacks: {
      onBatchEnd: async (batch, logs) => {
        ui.trainStatus("Loss: " + logs.loss.toFixed(5));
      }
    }
  });
}

let isPredicting = false;

async function predict() {
  ui.isPredicting();
  while (isPredicting) {
    // Capture the frame from the webcam.
    const img = await getImage();

    // Make a prediction through mobilenet, getting the internal activation of
    // the mobilenet model, i.e., "embeddings" of the input images.
    const embeddings = truncatedMobileNet.predict(img);

    // Make a prediction through our newly-trained model using the embeddings
    // from mobilenet as input.
    const predictions = model.predict(embeddings);

    // Returns the index with the maximum probability. This number corresponds
    // to the class the model thinks is the most probable given the input.
    const predictedClass = predictions.as1D().argMax();
    const classId = (await predictedClass.data())[0];
    img.dispose();

    ui.predictClass(classId);
    console.log(classId)
    await tf.nextFrame();
  }
  ui.donePredicting();
}

/**
 * Captures a frame from the webcam and normalizes it between -1 and 1.
 * Returns a batched image (1-element batch) of shape [1, w, h, c].
 */
async function getImage() {
  const img = await webcam.capture();
  const processedImg = tf.tidy(() =>
    img
      .expandDims(0)
      .toFloat()
      .div(127)
      .sub(1)
  );
  img.dispose();
  return processedImg;
}

document.getElementById("train").addEventListener("click", async () => {
  ui.trainStatus("Training...");
  console.log("training");
  tf.nextFrame();
  tf.nextFrame();
  isPredicting = false;
  train();
});
document.getElementById("predict").addEventListener("click", () => {
  console.log("predicting");
  ui.startPacman();
  isPredicting = true;
  predict();
});

async function init() {
  try {
    webcam = await tfd.webcam(document.getElementById("webcam"));
  } catch (e) {
    console.log(e);
    document.getElementById("no-webcam").style.display = "block";
  }
  truncatedMobileNet = await loadTruncatedMobileNet();

  ui.init();

  // Warm up the model. This uploads weights to the GPU and compiles the WebGL
  // programs so the first time we collect data from the webcam it will be
  // quick.
  const screenShot = await webcam.capture();
  truncatedMobileNet.predict(screenShot.expandDims(0));
  screenShot.dispose();
}
























const videoElement = document.querySelector('video');
const audioInputSelect = document.querySelector('select#audioSource');
const audioOutputSelect = document.querySelector('select#audioOutput');
const videoSelect = document.querySelector('select#videoSource');
const selectors = [audioInputSelect, audioOutputSelect, videoSelect];

audioOutputSelect.disabled = !('sinkId' in HTMLMediaElement.prototype);

function gotDevices(deviceInfos) {
  // Handles being called several times to update labels. Preserve values.
  const values = selectors.map(select => select.value);
  selectors.forEach(select => {
    while (select.firstChild) {
      select.removeChild(select.firstChild);
    }
  });
  for (let i = 0; i !== deviceInfos.length; ++i) {
    const deviceInfo = deviceInfos[i];
    const option = document.createElement('option');
    option.value = deviceInfo.deviceId;
    if (deviceInfo.kind === 'audioinput') {
      option.text = deviceInfo.label || `microphone ${audioInputSelect.length + 1}`;
      audioInputSelect.appendChild(option);
    } else if (deviceInfo.kind === 'audiooutput') {
      option.text = deviceInfo.label || `speaker ${audioOutputSelect.length + 1}`;
      audioOutputSelect.appendChild(option);
    } else if (deviceInfo.kind === 'videoinput') {
      option.text = deviceInfo.label || `camera ${videoSelect.length + 1}`;
      videoSelect.appendChild(option);
    } else {
      console.log('Some other kind of source/device: ', deviceInfo);
    }
  }
  selectors.forEach((select, selectorIndex) => {
    if (Array.prototype.slice.call(select.childNodes).some(n => n.value === values[selectorIndex])) {
      select.value = values[selectorIndex];
    }
  });
}

navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(handleError);

// Attach audio output device to video element using device/sink ID.
function attachSinkId(element, sinkId) {
  if (typeof element.sinkId !== 'undefined') {
    element.setSinkId(sinkId)
        .then(() => {
          console.log(`Success, audio output device attached: ${sinkId}`);
        })
        .catch(error => {
          let errorMessage = error;
          if (error.name === 'SecurityError') {
            errorMessage = `You need to use HTTPS for selecting audio output device: ${error}`;
          }
          console.error(errorMessage);
          // Jump back to first output device in the list as it's the default.
          audioOutputSelect.selectedIndex = 0;
        });
  } else {
    console.warn('Browser does not support output device selection.');
  }
}

function changeAudioDestination() {
  const audioDestination = audioOutputSelect.value;
  attachSinkId(videoElement, audioDestination);
}

function gotStream(stream) {
  window.stream = stream; // make stream available to console
  videoElement.srcObject = stream;
  console.log(`Success, Streaming`);
  // Refresh button list in case labels have become available
  return navigator.mediaDevices.enumerateDevices();
}

function handleError(error) {
  console.log('navigator.MediaDevices.getUserMedia error: ', error.message, error.name);
}

function start() {
  if (window.stream) {
    window.stream.getTracks().forEach(track => {
      track.stop();
    });
  }
  const audioSource = audioInputSelect.value;
  const videoSource = videoSelect.value;
  const constraints = {
    audio: {deviceId: audioSource ? {exact: audioSource} : undefined},
    video: {deviceId: videoSource ? {exact: videoSource} : undefined}
  };
  navigator.mediaDevices.getUserMedia(constraints).then(gotStream).then(gotDevices).catch(handleError);
}

audioInputSelect.onchange = start;
audioOutputSelect.onchange = changeAudioDestination;

videoSelect.onchange = start;

start();






// Initialize the application.
init();
