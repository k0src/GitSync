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

  const currentWindows = await browser.windows.getAll({ populate: true });
  const firstWindow =
    currentWindows[0] || (await browser.windows.create({ focused: false }));

  // Close all windows except the first one
  const windowsToClose = currentWindows.slice(1);
  await Promise.all(
    windowsToClose.map((win) => browser.windows.remove(win.id))
  );

  // First window
  const originalTabIds = firstWindow.tabs.map((tab) => tab.id);
  const firstRemoteWindow = remoteData.windows[0];
  const createdTabsInfo = [];

  // Create all new tabs for the first window
  if (firstRemoteWindow && firstRemoteWindow.groups) {
    for (const [groupName, tabs] of Object.entries(firstRemoteWindow.groups)) {
      for (const tab of tabs) {
        if (!isValidTabUrl(tab.url)) continue;
        const newTab = await browser.tabs.create({
          windowId: firstWindow.id,
          url: tab.url,
          pinned: tab.pinned,
          active: false,
        });
        createdTabsInfo.push({ tab: newTab, groupName: groupName });
      }
    }
  }

  // Group the new tabs
  const groupsToCreate = new Map();
  for (const { tab, groupName } of createdTabsInfo) {
    if (groupName !== "Ungrouped") {
      if (!groupsToCreate.has(groupName)) {
        groupsToCreate.set(groupName, []);
      }
      groupsToCreate.get(groupName).push(tab.id);
    }
  }

  for (const [groupName, tabIds] of groupsToCreate) {
    const groupId = await browser.tabs.group({ tabIds });
    await browser.tabGroups.update(groupId, { title: groupName });
  }

  // Activate the first new tab
  if (createdTabsInfo.length > 0) {
    await browser.tabs.update(createdTabsInfo[0].tab.id, { active: true });
  }

  // Remove all original tabs from the first window
  if (originalTabIds.length > 0) {
    await browser.tabs.remove(originalTabIds);
  }

  // Remaining windows
  for (let i = 1; i < remoteData.windows.length; i++) {
    const remoteWindowData = remoteData.windows[i];
    const allTabsInRemoteWindow = Object.values(
      remoteWindowData.groups || {}
    ).flat();
    if (allTabsInRemoteWindow.length === 0) continue;

    // Create a new window with one tab
    const newWindow = await browser.windows.create({
      focused: false,
      url: allTabsInRemoteWindow[0].url,
    });

    if (allTabsInRemoteWindow[0].pinned) {
      await browser.tabs.update(newWindow.tabs[0].id, { pinned: true });
    }

    const createdWindowTabsInfo = [
      {
        tab: newWindow.tabs[0],
        groupName: Object.keys(remoteWindowData.groups).find((key) =>
          remoteWindowData.groups[key].includes(allTabsInRemoteWindow[0])
        ),
      },
    ];

    // Create the rest of the tabs
    for (let j = 1; j < allTabsInRemoteWindow.length; j++) {
      const tabData = allTabsInRemoteWindow[j];
      const newTab = await browser.tabs.create({
        windowId: newWindow.id,
        url: tabData.url,
        pinned: tabData.pinned,
        active: false,
      });
      createdWindowTabsInfo.push({
        tab: newTab,
        groupName: Object.keys(remoteWindowData.groups).find((key) =>
          remoteWindowData.groups[key].includes(tabData)
        ),
      });
    }

    // Group the new tabs
    const newWindowGroups = new Map();
    for (const { tab, groupName } of createdWindowTabsInfo) {
      if (groupName !== "Ungrouped") {
        if (!newWindowGroups.has(groupName)) {
          newWindowGroups.set(groupName, []);
        }
        newWindowGroups.get(groupName).push(tab.id);
      }
    }

    for (const [groupName, tabIds] of newWindowGroups) {
      const groupId = await browser.tabs.group({ tabIds });
      await browser.tabGroups.update(groupId, { title: groupName });
    }
  }
}
