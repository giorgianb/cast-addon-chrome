"use strict"
/* Status values from cast-server */
const SUCCESS = 0;
const INVALID_PARAMETERS = 101;
const EXPIRED_CAST = 102;
const NO_CAST = 103;
const CAST_LOADING = 104;
const NEW_CASTER = 105;
const UNKNOWN  = 1000;

const COMMAND_PORT = 8080;
const LEGACY_UPDATE_PORT = 1337;
const UPDATE_PORT = 1338;

const CAST_SERVER_RANGE_SUPPORT_VERSION = "STABLE_0.1.2";
const PAUSE_ICON_PATH = "/icons/ic_pause_3x.png";
const PLAY_ICON_PATH = "/icons/ic_play_arrow_3x.png";

const VOLUME_OFF_ICON_PATH = "/icons/ic_volume_off_48pt_3x.png";
const VOLUME_LOW_ICON_PATH = "/icons/ic_volume_down_3x.png";
const VOLUME_HIGH_ICON_PATH = "/icons/ic_volume_up_3x.png";

/* whether setPosition was called: any messages specifying the position
 * will be ignored until setPosition receives a response */
var awaitingSetPositionResponse = false;
var settingPosition = false;

var awaitingSetVolumeResponse = false;
var settingVolume = false;

document.addEventListener("DOMContentLoaded", () => {
  const bInterface = localStorage.getItem("interface");
  if (bInterface == "legacy") {
    document.getElementById("interface").style.display = "none";
    document.getElementById("interfaceLegacy").style.display = "block";
  }

  restoreIPAddress();
  setTogglePlaybackIcon();
  setTogglePauseIconLegacy();
  setScrubberBar();
  setVolumeBar();
  setVolumeIcon();
  document.getElementById("togglePlaybackStatus").addEventListener("click", togglePlaybackStatus);
  document.getElementById("scrubberBar").addEventListener("change", setPosition);
  document.getElementById("scrubberBar").addEventListener("mouseup", () => {
    settingPosition = false;
  });
  document.getElementById("scrubberBar").addEventListener("mousedown", () => {
    settingPosition = true;
  });

  document.getElementById("volumeBar").addEventListener("input", setVolume);
  document.getElementById("volumeBar").addEventListener("input", setVolumeIcon);
  document.getElementById("volumeBar").addEventListener("mouseup", () => {
    settingVolume = false;
  });
  document.getElementById("volumeBar").addEventListener("mousedown", () => {
    settingVolume = true;
  });

  document.getElementById("backwards30").addEventListener("click", () => { seek(-30 * 10**6); });
  document.getElementById("backwards5").addEventListener("click", () => { seek(-5 * 10**6); });
  document.getElementById("stop").addEventListener("click", quit);
  document.getElementById("forward5").addEventListener("click", () => { seek(5 * 10**6); });
  document.getElementById("forward30").addEventListener("click", () => { seek(30 * 10**6); });

  document.getElementById("ipAddress").addEventListener("input", storeIPAddress);
  document.getElementById("cast").addEventListener("click", cast);
  document.getElementById("togglePauseLegacy").addEventListener("click", togglePauseLegacy);
  document.getElementById("skipForwardLegacy").addEventListener("click", skipForwardLegacy);
  document.getElementById("skipBackwardsLegacy").addEventListener("click", skipBackwardsLegacy);
  document.getElementById("volumeDownLegacy").addEventListener("click", volumeDownLegacy);
  document.getElementById("volumeUpLegacy").addEventListener("click", volumeUpLegacy);
  document.getElementById("toggleSubtitlesLegacy").addEventListener("click", toggleSubtitlesLegacy);

  document.getElementById("alertMessageDiv").addEventListener("click", () => {
    document.getElementById("alertMessageDiv").style.display = "none";
  });
});

function cast() {
  const ipAddress = localStorage.getItem("ipAddress");
  if (ipAddress === "") {
    alertUser("Please enter the cast IP address.");
    return;
  }

  let currentTab = chrome.tabs.query({
    active: true,
    currentWindow: true
  }, (tabInfo) => {
    let tabURL = escape(tabInfo[0].url);
    let request = new XMLHttpRequest();

    request.onreadystatechange = () => {
      if (request.readyState === XMLHttpRequest.DONE) {
        const response = (request.responseText) ? JSON.parse(request.responseText) : null;
        switch (request.status) {
          case 0:
            alertUser("Unable to reach cast server.");
            break;
          case 200:
            if ("version" in response && response.version >= CAST_SERVER_RANGE_SUPPORT_VERSION) {
              localStorage.setItem("interface", "new");
              localStorage.setItem("duration", response.duration);
              showNewInterface();
              setTogglePlaybackIcon();
              setVolumeBar();
              setVolumeIcon();
            } else {
              localStorage.set("interface", "legacy");
              showLegacyInterface();
              setTogglePauseIconLegacy();
            }
            break;
          case 400:
            switch (response && response.status) {
              case INVALID_PARAMETERS:
                alertUser("Congrats, you found a bug!");
                break;
              case EXPIRED_CAST:
                alertUser("Someone else cast a video.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          case 500:
            switch (response && response.status) {
              case UNKNOWN:
                alertUser("Error casting video.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          default:
            alertUser("Unknown error. Sorry!");
            break;
        }
      }
    };

    /* TODO: Update to use POST in future version */
    request.open("GET",
      "http://" + ipAddress + ":" + COMMAND_PORT + "/cast?video=" + tabURL,
      true
    );
    request.send();

  });

  /* Attempt to connect to new update port */
  const connection = new WebSocket("ws://" + ipAddress + ":" + UPDATE_PORT);
  connection.onopen = () => {
    localStorage.setItem("interface", "new");
    showNewInterface();
  };

  connection.onmessage = handleMessage;

  /* If unsuccessful, connect to old update port */
  connection.onclose = (e) => {
    if (e.code === 1006) {
      const connectionLegacy = new WebSocket("ws://" + ipAddress + ":" + LEGACY_UPDATE_PORT);
      connectionLegacy.onopen = () => {
        localStorage.setItem("interface", "legacy");
        showLegacyInterface();
      };

      connectionLegacy.onmessage = handleMessageLegacy;
    }
  }
}

function setTogglePlaybackIcon() {
  const ipAddress = localStorage.getItem("ipAddress");
  if (ipAddress)
    sendSimpleCommand("getPlaybackStatus", (request) => {
      if (request.readyState == XMLHttpRequest.DONE && request.status == 200) { 
        const playing = (request.responseText && JSON.parse(request.responseText).playbackStatus) === "Playing";
        document.getElementById("togglePlaybackStatus").src = (playing) ? PAUSE_ICON_PATH : PLAY_ICON_PATH;
      }
    });
}

function togglePlaybackStatus() {
  const playing = document.getElementById("togglePlaybackStatus").src.indexOf(PAUSE_ICON_PATH) >= 0;
  sendSimpleCommand(playing ? "pause" : "play", (request) => {
    if (request.readyState === XMLHttpRequest.DONE) {
      const response = (request.responseText) ? JSON.parse(request.responseText) : null;
      switch (request.status) {
        case 0:
          alertUser("Unable to reach cast server.");
          break;
        case 200:
          /* do nothing */
          break;
        case 400:
          switch (response && response.status) {
            case NEW_CASTER:
              alertUser("Someone else cast a video.");
              break;
            case EXPIRED_CAST:
              alertUser("Cast expired.");
              break;
            case NO_CAST:
              alertUser("No video is being cast.");
              break;
            case CAST_LOADING:
              alertUser("Video loading.");
              break;
            default:
              alertUser("Unknown error. Sorry!");
              break;
          }
          break;
        case 500:
          switch (response && response.status) {
            case UNKNOWN:
              alertUser("Error " + ((playing) ? "pausing" : "playing") + " video");
              break;
            default:
              alertUser("Unknown error. Sorry!");
              break;
          }
          break;
        default:
          alertUser("Unknown error. Sorry!");
          break;
      }
    }
  });
}

function setScrubberBar() {
  const ipAddress = localStorage.getItem("ipAddress");
  const duration = localStorage.getItem("duration");
  const position = localStorage.getItem("position");

  const scrubberBar = document.getElementById("scrubberBar");
  const min = parseInt(scrubberBar.min, 10);
  const max = parseInt(scrubberBar.max, 10);

  if (duration && position)
    scrubberBar.value = Math.floor(position / duration * (max - min)) + min;

  if (ipAddress)
    sendSimpleCommand("getDuration", (request) => {
      if (request.readyState == XMLHttpRequest.DONE && request.status == 200) { 
        const duration = JSON.parse(request.responseText).duration;

        localStorage.setItem("duration", duration);
        sendSimpleCommand("getPosition", (request) => {
          if (request.readyState == XMLHttpRequest.DONE && request.status == 200) { 
            const position = JSON.parse(request.responseText).position;
            const status = JSON.parse(request.responseText).status;
            if (!settingPosition && !awaitingSetPositionResponse) {
              localStorage.setItem("position", position);
              scrubberBar.value = Math.floor(position / duration * (max - min)) + min;
            }
          }
        });
      } else if (!settingPosition && !awaitingSetPositionResponse) {
        scrubberBar.value = 0;
        localStorage.setItem("position", 0);
      }
    });
}

function setVolumeBar() {
  if (!settingVolume && !awaitingSetVolumeResponse) {
    const ipAddress = localStorage.getItem("ipAddress");
    const storedMaxVolume = localStorage.getItem("maxVolume");
    const storedMinVolume = localStorage.getItem("minVolume");
    const volume = localStorage.getItem("volume");

    const volumeBar = document.getElementById("volumeBar");
    const min = parseInt(volumeBar.min, 10);
    const max = parseInt(volumeBar.max, 10);

    const maxVolume = parseFloat(storedMaxVolume, 10) || 500;
    const minVolume = parseFloat(storedMinVolume, 10) || -4000;
    if (volume) {
      const mb = 2000 * Math.log10(volume);
      volumeBar.value = (mb >= 0) ? mb / maxVolume * max : mb / minVolume * min;
    }

    if (ipAddress)
      sendSimpleCommand("getVolume", (request) => {
        if (request.readyState === XMLHttpRequest.DONE && request.status == 200) {
          const volume = JSON.parse(request.responseText).volume;

          if (!settingVolume && !awaitingSetVolumeResponse) {
            const mb = 2000 * Math.log10(volume);
            localStorage.setItem("volume", volume);
            volumeBar.value = (mb >= 0) ? mb / maxVolume * max : mb / minVolume * min;
          }
        }
      });
  }
}

function setVolumeIcon() {
  const volumeBar = document.getElementById("volumeBar");
  const volumeButton = document.getElementById("volume");
  const min = parseInt(volumeBar.min, 10);
  const current = parseInt(volumeBar.value, 10);

  if (current === min)
    volume.src = VOLUME_OFF_ICON_PATH;
  else if (current < 0)
    volume.src = VOLUME_LOW_ICON_PATH;
  else
    volume.src = VOLUME_HIGH_ICON_PATH;
}

function setPosition() {
  const ipAddress = localStorage.getItem("ipAddress");
  const duration = localStorage.getItem("duration");

  if (ipAddress && duration) {
    const scrubberBar = document.getElementById("scrubberBar");
    const min = parseInt(scrubberBar.min, 10);
    const max = parseInt(scrubberBar.max, 10);
    const value = parseInt(scrubberBar.value, 10);

    const position = Math.floor(value/(max - min) * duration);
    localStorage.setItem("position", position);

    /* TODO: add checking for errors such as EXPIRED_CAST, etc
     * Also prevent getPosition from changing input bar until response received
     */
    let request = new XMLHttpRequest();
    awaitingSetPositionResponse = true;
    request.onreadystatechange = () => {
      if (request.readyState == XMLHttpRequest.DONE) {
        awaitingSetPositionResponse = false; 

        const response = (request.responseText) ? JSON.parse(request.responseText) : null;
        switch (request.status) {
          case 0:
            alertUser("Unable to reach cast server.");
            break;
          case 200:
            /* do nothing */
            break;
          case 400:
            switch (response && response.status) {
              case NEW_CASTER:
                alertUser("Someone else cast a video.");
                break;
              case EXPIRED_CAST:
                alertUser("Cast expired.");
                break;
              case NO_CAST:
                alertUser("No video is being cast.");
                break;
              case CAST_LOADING:
                alertUser("Video loading.");
                break;
              case INVALID_PARAMETERS:
                alertUser("Congrats, you found a bug!");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          case 500:
            switch (response && response.status) {
              case UNKNOWN:
                alertUser("Error setting position.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          default:
            alertUser("Unknown error. Sorry!");
            break;
        }
      }
    }

    request.open("POST",
      "http://" + ipAddress + ":" + COMMAND_PORT + "/setPosition?position=" + position,
      true
    );
    request.send();
  }
}

function setVolume() {
  const ipAddress = localStorage.getItem("ipAddress");
  const storedMaxVolume = localStorage.getItem("maxVolume");
  const storedMinVolume = localStorage.getItem("minVolume");
  const maxVolume = parseFloat(storedMaxVolume, 10) || 500;
  const minVolume = parseFloat(storedMinVolume, 10) || -4000;

  if (ipAddress) {
    const volumeBar = document.getElementById("volumeBar");
    const min = parseInt(volumeBar.min, 10);
    const max = parseInt(volumeBar.max, 10);
    const value = parseInt(volumeBar.value, 10);
    const volume = Math.pow(10, ((value >= 0) ? value/max * maxVolume : value/min * minVolume) / 2000);

    localStorage.setItem("volume", volume);

    let request = new XMLHttpRequest();
    awaitingSetVolumeResponse = true;
    request.onreadystatechange = () => {
      if (request.readyState == XMLHttpRequest.DONE) {
        awaitingSetVolumeResponse = false;

        const response = (request.responseText) ? JSON.parse(request.responseText) : null;
        switch (request.status) {
          case 0:
            alertUser("Unable to reach cast server.");
            break;
          case 200:
            /* TODO: maybe read returned volume and set the volume bar to it */
            break;
          case 400:
            switch (response && response.status) {
              case NEW_CASTER:
                alertUser("Someone else cast a video.");
                break;
              case EXPIRED_CAST:
                alertUser("Cast expired.");
                break;
              case NO_CAST:
                alertUser("No video is being cast.");
                break;
              case CAST_LOADING:
                alertUser("Video loading.");
                break;
              case INVALID_PARAMETERS:
                alertUser("Congrats, you found a bug!");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          case 500:
            switch (response && response.status) {
              case UNKNOWN:
                alertUser("Error setting volume.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          default:
            alertUser("Unknown error. Sorry!");
            break;
        }
      }
    };

    request.open("POST",
      "http://" + ipAddress + ":" + COMMAND_PORT + "/setVolume?volume=" + volume,
      true
    );
    request.send();
  }
}

function seek(offset) {
  const ipAddress = localStorage.getItem("ipAddress");
  if (ipAddress) {
    let request = new XMLHttpRequest();

    request.open("POST",
      "http://" + ipAddress + ":" + COMMAND_PORT + "/" + "seek?offset=" + offset,
      true);
    request.onreadystatechange = () => {
      if (request.readyState == XMLHttpRequest.DONE) {
        const response = (request.responseText) ? JSON.parse(request.responseText) : null;
        switch (request.status) {
          case 0:
            alertUser("Unable to reach cast server.");
            break;
          case 200:
            break;
          case 400:
            switch (response && response.status) {
              case NEW_CASTER:
                alertUser("Someone else cast a video.");
                break;
              case EXPIRED_CAST:
                alertUser("Cast expired.");
                break;
              case NO_CAST:
                alertUser("No video is being cast.");
                break;
              case CAST_LOADING:
                alertUser("Video loading.");
                break;
              case INVALID_PARAMETERS:
                /* TODO: check if this error message is accurate */
                alertUser("Unable to seek there.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          case 500:
            switch (response && response.status) {
              case UNKNOWN:
                alertUser("Error seeking video.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          default:
            alertUser("Unknown error. Sorry!");
            break;
        }
      }
    };

    request.send();
  }
}

function quit() {
  const ipAddress = localStorage.getItem("ipAddress");
  if (ipAddress) {
    let request = new XMLHttpRequest();

    request.open("POST",
      "http://" + ipAddress + ":" + COMMAND_PORT + "/" + "quit",
      true
    );


    request.onreadystatechange = () => {
      if (request.readyState == XMLHttpRequest.DONE) {
        const response = (request.responseText) ? JSON.parse(request.responseText) : null;
        switch (request.status) {
          case 0:
            alertUser("Unable to reach cast server.");
            break;
          case 200:
            break;
          case 400:
            switch (response && response.status) {
              case NEW_CASTER:
                alertUser("Someone else cast a video.");
                break;
              case EXPIRED_CAST:
                alertUser("Cast expired.");
                break;
              case NO_CAST:
                alertUser("No video is being cast.");
                break;
              case CAST_LOADING:
                alertUser("Video loading.");
                break;
              case INVALID_PARAMETERS:
                alertUser("Congrats, you found a bug!");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          case 500:
            switch (response && response.status) {
              case UNKNOWN:
                alertUser("Error stopping video.");
                break;
              default:
                alertUser("Unknown error. Sorry!");
                break;
            }
            break;
          default:
            alertUser("Unknown error. Sorry!");
            break;
        }
      }
    };

    request.send();
  }
}


function sendSimpleCommand(command, callback) {
  const ipAddress = localStorage.getItem("ipAddress");
  if (!ipAddress) {
    alertUser("Please enter the cast IP address.");
    return;
  }

  let request = new XMLHttpRequest();

  request.onreadystatechange = () => {
    if (callback)
      callback(request);
  };

  request.open("GET",
    "http://" + ipAddress + ":" + COMMAND_PORT + "/" + command,
    true
  );

  request.send();
}

function showNewInterface() {
  document.getElementById("interface").style.display = "block";
  document.getElementById("interfaceLegacy").style.display = "none";
  document.querySelector("body").style.width = "240px";
  document.getElementById("ipAddress").style.width = "175px";
}

function showLegacyInterface() {
  document.getElementById("interface").style.display = "none";
  document.getElementById("interfaceLegacy").style.display = "block";
  document.querySelector("body").style.width = "175px";
  document.getElementById("ipAddress").style.width = "100px";
}

function handleMessage(message) {
  const data = JSON.parse(message.data);
  switch (data.messageType) {
    case "playbackStatus":
      const playing = data.playbackStatus === "Playing";
      document.getElementById("togglePlaybackStatus").src = (playing) ? PAUSE_ICON_PATH : PLAY_ICON_PATH;
      if (data.playbackStatus === "Stopped")
        document.getElementById("scrubberBar").value = 0;

      break;
    case "position":
      if (!awaitingSetPositionResponse && !settingPosition) {
        const position = data.position;
        const duration = localStorage.getItem("duration");
        const scrubberBar = document.getElementById("scrubberBar");
        const min = parseInt(scrubberBar.min, 10);
        const max = parseInt(scrubberBar.max, 10);

        if (position < duration && !settingPosition) {
          localStorage.setItem("position", position);
          scrubberBar.value = Math.floor(position / duration * (max - min) + min);
        }
        break;
      }
  }
}

function storeIPAddress() {
  localStorage.setItem("ipAddress", document.getElementById("ipAddress").value);
}

function restoreIPAddress() {
  const ipAddress = localStorage.getItem("ipAddress");
  if (ipAddress) {
    document.getElementById("ipAddress").value = ipAddress;

    /* Attempt to connect to new update port */
    const connection = new WebSocket("ws://" + ipAddress + ":" + UPDATE_PORT);
    connection.onmessage = handleMessage;
    connection.onopen = () => {
      localStorage.setItem("interface", "new")
      showNewInterface();
    };

    /* If unsuccessful, connect to old update port */
    connection.onclose = (e) => {
      if (e.code === 1006) {
        const connectionLegacy = new WebSocket("ws://" + ipAddress + ":" + LEGACY_UPDATE_PORT);
        connectionLegacy.onopen = () => {
          localStorage.setItem("interface", "legacy")
          showLegacyInterface();
        };

        connectionLegacy.onmessage = handleMessageLegacy;
      }
    }
  }
}

function handleMessageLegacy(message) {
  const playing = JSON.parse(message.data).isPlaying;
  document.getElementById("togglePauseLegacy").src = (playing) ? PAUSE_ICON_PATH : PLAY_ICON_PATH;
}



/* Legacy Support Functions */
function setTogglePauseIconLegacy() {
  const ipAddress = localStorage.getItem("ipAddress");
  if (ipAddress)
    sendSimpleCommand("isPlaying", (request) => {
      if (request.readyState == XMLHttpRequest.DONE && request.status == 200) { 
        const playing = JSON.parse(request.responseText).isPlaying;
        document.getElementById("togglePauseLegacy").src = "/icons/" + ((playing) ? "ic_pause_3x.png"
          : "ic_play_arrow_3x.png");
      }
    });
}

function togglePauseLegacy() {
  sendSimpleCommand("togglePause");
}

function skipForwardLegacy() {
  sendSimpleCommand("skipForward");
}

function skipBackwardsLegacy() {
  sendSimpleCommand("skipBackwards");
}

function volumeDownLegacy() {
  sendSimpleCommand("volumeDown");
}

function volumeUpLegacy() {
  sendSimpleCommand("volumeUp");
}

function volumeUpLegacy() {
  sendSimpleCommand("volumeUp");
}

function toggleSubtitlesLegacy() {
  sendSimpleCommand("toggleSubtitles");
}

function alertUser(message) {
  const alertMessage = document.getElementById("alertMessage");
  const alertMessageDiv = document.getElementById("alertMessageDiv");
  alertMessage.innerHTML = message;
  alertMessageDiv.style.display = "block";
}
