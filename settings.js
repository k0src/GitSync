document.addEventListener("DOMContentLoaded", async function () {
  const ownerInput = document.getElementById("owner");
  const repoInput = document.getElementById("repo");
  const tokenInput = document.getElementById("token");
  const blacklistInput = document.getElementById("blacklist");
  const autopushInput = document.getElementById("autopush");
  const saveBtn = document.getElementById("save");
  const testBtn = document.getElementById("test");
  const clearTokenBtn = document.getElementById("clear-token");
  const clearTabsBtn = document.getElementById("clear-tabs");
  const status = document.getElementById("status");

  const settings = await browser.storage.sync.get([
    "githubOwner",
    "githubRepo",
    "githubToken",
    "urlBlacklist",
    "autoPushInterval",
  ]);
  if (settings.githubOwner) ownerInput.value = settings.githubOwner;
  if (settings.githubRepo) repoInput.value = settings.githubRepo;
  if (settings.githubToken) tokenInput.value = settings.githubToken;
  if (settings.urlBlacklist) blacklistInput.value = settings.urlBlacklist;
  autopushInput.value = settings.autoPushInterval || 0;

  saveBtn.addEventListener("click", async function () {
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const token = tokenInput.value.trim();
    const blacklist = blacklistInput.value.trim();
    const autoPushValue = autopushInput.value.trim();

    if (!owner || !repo || !token) {
      showStatus("Please fill in GitHub owner, repository, and token", "error");
      return;
    }

    const interval = Number(autoPushValue);
    if (isNaN(interval) || interval < 0 || !Number.isInteger(interval)) {
      showStatus("Auto Push must be a whole number.", "error");
      return;
    }

    await browser.storage.sync.set({
      githubOwner: owner,
      githubRepo: repo,
      githubToken: token,
      urlBlacklist: blacklist,
      autoPushInterval: interval,
    });

    browser.runtime.sendMessage({ action: "updateAlarm" });

    showStatus("Settings saved successfully!", "success");
  });

  testBtn.addEventListener("click", async function () {
    const owner = ownerInput.value.trim();
    const repo = repoInput.value.trim();
    const token = tokenInput.value.trim();

    if (!owner || !repo || !token) {
      showStatus("Please fill in all GitHub fields first", "error");
      return;
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          headers: {
            Authorization: `token ${token}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );

      if (response.ok) {
        showStatus("Connection successful!", "success");
      } else {
        showStatus(
          `Connection failed: ${response.status} ${response.statusText}`,
          "error"
        );
      }
    } catch (error) {
      showStatus(`Connection error: ${error.message}`, "error");
    }
  });

  clearTokenBtn.addEventListener("click", async function () {
    await browser.storage.sync.remove("githubToken");
    tokenInput.value = "";
    showStatus("Token has been cleared from storage.", "success");
  });

  clearTabsBtn.addEventListener("click", async function () {
    showStatus("Clearing all saved tabs on GitHub...", "normal");
    try {
      const response = await browser.runtime.sendMessage({
        action: "clearTabs",
      });
      if (response && response.success) {
        showStatus("Remote tabs file has been cleared.", "success");
      } else {
        showStatus(
          `Error: ${response ? response.error : "Unknown error"}`,
          "error"
        );
      }
    } catch (error) {
      showStatus(`Error: ${error.message}`, "error");
    }
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = type || "";
  }
});
