function saveOptions(e) {
  e.preventDefault();
  localStorage.setItem("maxVolume", document.getElementById("maxVolume").value);
  localStorage.setItem("minVolume", document.getElementById("minVolume").value);
}

function restoreOptions() {
  const maxVolume = localStorage.getItem("maxVolume");
  document.getElementById("maxVolume").value = maxVolume || 500;

  const minVolume = localStorage.getItem("minVolume");
  document.getElementById("minVolume").value = minVolume || -4000;
}

document.addEventListener("DOMContentLoaded", restoreOptions);
document.querySelector("form").addEventListener("submit", saveOptions);
