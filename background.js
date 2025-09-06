const AUTO_PUSH_ALARM_NAME = "gitsync-auto-push";

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "push") {
    handlePush().then(sendResponse);
    return true;
  } else if (request.action === "pull") {
    handlePull().then(sendResponse);
    return true;
  } else if (request.action === "clearTabs") {
    handleClearTabs().then(sendResponse);
    return true;
  } else if (request.action === "updateAlarm") {
    setupAutoPushAlarm();
  }
});

async function setupAutoPushAlarm() {
  const { autoPushInterval } = await browser.storage.sync.get(
    "autoPushInterval"
  );
  await browser.alarms.clear(AUTO_PUSH_ALARM_NAME);
  if (autoPushInterval > 0) {
    browser.alarms.create(AUTO_PUSH_ALARM_NAME, {
      periodInMinutes: autoPushInterval,
    });
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === AUTO_PUSH_ALARM_NAME) {
    handlePush();
  }
});

setupAutoPushAlarm();

async function handlePush() {
  try {
    const settings = await browser.storage.sync.get([
      "githubOwner",
      "githubRepo",
      "githubToken",
      "urlBlacklist",
    ]);

    if (
      !settings.githubOwner ||
      !settings.githubRepo ||
      !settings.githubToken
    ) {
      return {
        success: false,
        error: "Please configure GitHub settings first",
      };
    }

    const localData = await getCurrentTabsAndGroups(settings.urlBlacklist);

    // Save to GitHub (overwrite remote)
    await saveRemoteData(settings, localData);

    return { success: true };
  } catch (error) {
    console.error("Push error:", error);
    return { success: false, error: error.message };
  }
}

async function handleClearTabs() {
  try {
    const settings = await browser.storage.sync.get([
      "githubOwner",
      "githubRepo",
      "githubToken",
    ]);

    if (
      !settings.githubOwner ||
      !settings.githubRepo ||
      !settings.githubToken
    ) {
      return {
        success: false,
        error: "Please configure GitHub settings first",
      };
    }

    const emptyData = { windows: [] };

    await saveRemoteData(settings, emptyData);
    return { success: true };
  } catch (error) {
    console.error("Clear tabs error:", error);
    return { success: false, error: error.message };
  }
}

async function saveRemoteData(settings, data, maxRetries = 5, delayMs = 300) {
  const content = btoa(JSON.stringify(data, null, 2));

  async function fetchSha() {
    try {
      const response = await fetch(
        `https://api.github.com/repos/${settings.githubOwner}/${
          settings.githubRepo
        }/contents/gitsync.json?cachebuster=${Date.now()}`,
        {
          headers: {
            Authorization: `token ${settings.githubToken}`,
            Accept: "application/vnd.github.v3+json",
            "Cache-Control": "no-cache",
          },
        }
      );

      if (!response.ok) return null;
      const fileData = await response.json();
      return fileData.sha;
    } catch {
      return null;
    }
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let sha = await fetchSha();
    const payload = {
      message: "Update GitSync data",
      content,
      sha: sha || undefined,
    };

    const response = await fetch(
      `https://api.github.com/repos/${settings.githubOwner}/${settings.githubRepo}/contents/gitsync.json`,
      {
        method: "PUT",
        headers: {
          Authorization: `token ${settings.githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify(payload),
      }
    );

    if (response.ok) {
      return;
    }

    if (response.status === 409) {
      await new Promise((res) => setTimeout(res, delayMs));
      continue;
    }

    throw new Error(`Failed to save to GitHub: ${response.status}`);
  }

  throw new Error(
    `Failed to save after ${maxRetries} attempts due to repeated 409 conflicts`
  );
}

async function handlePull() {
  try {
    const settings = await browser.storage.sync.get([
      "githubOwner",
      "githubRepo",
      "githubToken",
    ]);

    if (
      !settings.githubOwner ||
      !settings.githubRepo ||
      !settings.githubToken
    ) {
      return {
        success: false,
        error: "Please configure GitHub settings first",
      };
    }

    // Get remote data from GitHub
    const remoteData = await getRemoteData(settings);

    // Close all current tabs and open remote tabs
    await replaceAllTabsWithRemote(remoteData);

    return { success: true };
  } catch (error) {
    console.error("Pull error:", error);
    return { success: false, error: error.message };
  }
}

async function getRemoteData(settings) {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${settings.githubOwner}/${
        settings.githubRepo
      }/git/trees/main?recursive=1&cachebuster=${Date.now()}`,
      {
        headers: {
          Authorization: `token ${settings.githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Cache-Control": "no-cache",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status}`);
    }

    const treeData = await response.json();
    const fileItem = treeData.tree.find((item) => item.path === "gitsync.json");

    if (!fileItem) {
      return { windows: [{ groups: {} }] };
    }

    const blobResponse = await fetch(
      `https://api.github.com/repos/${settings.githubOwner}/${settings.githubRepo}/git/blobs/${fileItem.sha}`,
      {
        headers: {
          Authorization: `token ${settings.githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Cache-Control": "no-cache",
        },
      }
    );

    if (!blobResponse.ok) {
      throw new Error(`Failed to fetch blob: ${blobResponse.status}`);
    }

    const blobData = await blobResponse.json();
    const content = atob(blobData.content.replace(/\s/g, ""));
    return JSON.parse(content);
  } catch (error) {
    console.error("No remote data found or error reading:", error);
    return { windows: [{ groups: {} }] };
  }
}

function isValidTabUrl(url, userBlacklist = []) {
  if (!url) return false;
  const forbidden = ["about:", "moz-extension:", ...userBlacklist];
  return !forbidden.some((prefix) => url.startsWith(prefix));
}

async function getCurrentTabsAndGroups(blacklistString = "") {
  const windows = await browser.windows.getAll({ populate: true });
  const tabGroups = await browser.tabGroups.query({});

  const blacklist = blacklistString
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const result = { windows: [] };

  for (const window of windows) {
    const groups = {};
    for (const tab of window.tabs) {
      if (!isValidTabUrl(tab.url, blacklist)) continue;

      let groupName = "Ungrouped";

      if (tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
        const group = tabGroups.find((g) => g.id === tab.groupId);
        groupName = group
          ? group.title || `Group ${group.id}`
          : `Group ${tab.groupId}`;
      }

      if (!groups[groupName]) {
        groups[groupName] = [];
      }

      groups[groupName].push({
        url: tab.url,
        pinned: tab.pinned || false,
      });
    }

    result.windows.push({ groups });
  }

  return result;
}

async function replaceAllTabsWithRemote(remoteData) {
  if (!remoteData || !remoteData.windows || remoteData.windows.length === 0) {
    throw new Error("Nothing to pull.");
  }
  // Get all current windows and tabs
  const currentWindows = await browser.windows.getAll({ populate: true });

  if (currentWindows.length === 0) {
    // If no windows, create one
    await browser.windows.create({ focused: false });
  }

  // Keep first local window for first remote window, remove all others
  const firstWindow = currentWindows[0];
  const windowsToClose = currentWindows.slice(1);
  await Promise.all(
    windowsToClose.map((win) => browser.windows.remove(win.id))
  );

  // Replace tabs in first window with the first remote window
  const firstRemoteWindow = remoteData.windows[0];
  const groups = firstRemoteWindow.groups || {};
  let firstTabReplaced = false;

  for (const [groupName, tabs] of Object.entries(groups)) {
    const newTabIds = [];

    for (const tab of tabs) {
      if (!isValidTabUrl(tab.url)) continue;

      let newTab;

      if (!firstTabReplaced && firstWindow.tabs.length > 0) {
        // Replace first tab
        await browser.tabs.update(firstWindow.tabs[0].id, {
          url: tab.url,
          pinned: tab.pinned,
        });
        newTab = firstWindow.tabs[0];
        firstTabReplaced = true;
      } else {
        newTab = await browser.tabs.create({
          windowId: firstWindow.id,
          url: tab.url,
          pinned: tab.pinned,
          active: false,
        });
      }

      newTabIds.push(newTab.id);
    }

    // Create tab group
    if (newTabIds.length > 0 && groupName !== "Ungrouped") {
      const groupId = await browser.tabs.group({ tabIds: newTabIds });
      await browser.tabGroups.update(groupId, { title: groupName });
    }
  }

  // Handle the rest of the windows
  for (let w = 1; w < remoteData.windows.length; w++) {
    const remoteWindow = remoteData.windows[w];
    const groups = remoteWindow.groups || {};
    const allTabs = Object.values(groups).flat();

    if (allTabs.length === 0) continue;

    // Create the new window with the first tab's URL
    const targetWindow = await browser.windows.create({
      focused: false,
      url: allTabs[0].url,
    });

    const newTabIds = [targetWindow.tabs[0].id];

    // Create the remaining tabs
    for (let i = 1; i < allTabs.length; i++) {
      const tab = allTabs[i];
      const newTab = await browser.tabs.create({
        windowId: targetWindow.id,
        url: tab.url,
        pinned: tab.pinned,
        active: false,
      });
      newTabIds.push(newTab.id);
    }

    // Groups
    let offset = 0;
    for (const [groupName, tabs] of Object.entries(groups)) {
      if (groupName === "Ungrouped") {
        offset += tabs.length;
        continue;
      }
      const groupTabIds = newTabIds.slice(offset, offset + tabs.length);
      const groupId = await browser.tabs.group({ tabIds: groupTabIds });
      await browser.tabGroups.update(groupId, { title: groupName });
      offset += tabs.length;
    }
  }
}
