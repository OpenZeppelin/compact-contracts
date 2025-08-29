# Releasing

(1) Checkout the branch to be released.
This will usually be `main` except in the event of a hotfix.
For hotfixes, checkout the release branch you want to fix.

(2) Create a new release branch.

```sh
git checkout -b release-v0.2.0
```

(3) Push and open a PR targeting `main` to carefully review the release changes.
This will trigger a GitHub workflow that automatically bumps the version number throughout the project.

```sh
git push release-v0.2.0
```

(4) Once merged, pull the changes from the release branch.
Then, create a tag on the release branch and push it to the main repository.
Note that the version changes must be pulled *before* the tag is created;
otherwise, the version validation check will fail in the release workflow.

```sh
git pull
git tag v0.2.0
git push origin v0.2.0
```

(5) After that, go to the repo's [releases page](https://github.com/OpenZeppelin/compact-contracts/releases/).
[Create a new release](https://github.com/OpenZeppelin/compact-contracts/releases/new) with the new tag and the base branch as target (`main` except in the event of a hotfix).
Make sure to write a detailed release description and a short changelog.
Once published, this will trigger a workflow to upload the release tarball to npm.

(6) Finally, from the released tag,
create and push a doc branch to deploy the corresponding version to the doc-site.

```sh
git checkout -b docs-v0.2.0
git push docs-v0.2.0
```
