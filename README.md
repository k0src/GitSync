GitSync saves your browser session, including all open tabs and tab groups, to a GitHub repository. You can then load this session on another computer.

The add-on provides manual controls to "push" (save) your current session and "pull" (load) a saved session. It also includes an optional auto-push feature to periodically back up your tabs at a user-defined interval. A URL filter allows you to exclude specific sites from being saved.

#### How to Use:
- Create a new private repository on GitHub (e.g., "`gitsync-data`").
- Generate a Personal Access Token (PAT) by going to `GitHub` > `Settings` > `Developer settings` > `Personal access tokens` > `Tokens (classic)`.
- Click "Generate new token," give it a name, set an expiration, and grant it the full repo scope.
- Copy the generated token (`ghp_...`).
- In the GitSync settings, enter your GitHub username, repository name, and the Personal Access Token.

#### [Add to Firefox](https://addons.mozilla.org/en-US/firefox/addon/gitsync/)

Known issues:
- Tabs with the same url on local and remote get duplicated. In process of being fixed. 