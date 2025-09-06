document.addEventListener("DOMContentLoaded", function () {
  const pushBtn = document.getElementById("push");
  const pullBtn = document.getElementById("pull");
  const settingsBtn = document.getElementById("settings");
  const status = document.getElementById("status");

  function showStatus(message, type = "") {
    status.textContent = message;
    status.className = type || "";
  }

  pushBtn.addEventListener("click", async function () {
    showStatus("Pushing...");
    try {
      const response = await browser.runtime.sendMessage({ action: "push" });
      if (response && response.success) {
        showStatus("Push complete!", "success");
      } else {
        showStatus(
          "Push failed: " + (response ? response.error : "Unknown error"),
          "error"
        );
      }
    } catch (error) {
      showStatus("Error: " + error.message, "error");
    }
  });

  pullBtn.addEventListener("click", async function () {
    showStatus("Pulling...");
    try {
      const response = await browser.runtime.sendMessage({ action: "pull" });
      if (response && response.success) {
        showStatus("Pull complete!", "success");
      } else {
        showStatus(
          "Pull failed: " + (response ? response.error : "Unknown error"),
          "error"
        );
      }
    } catch (error) {
      showStatus("Error: " + error.message, "error");
    }
  });

  settingsBtn.addEventListener("click", function () {
    browser.tabs.create({ url: browser.runtime.getURL("settings.html") });
    window.close();
  });
});
