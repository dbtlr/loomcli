//! Finding a release on GitHub: a named version's `SHA256SUMS`, the newest stable release through
//! `releases/latest`, and the newest release on a prerelease channel through the releases Atom
//! feed. Owners and names compare without regard to case, and a redirect GitHub answers for a
//! renamed repository names the repository every later request uses.

use std::io;

use url::Url;

use super::request::{Client, Followed, GITHUB, NOT_FOUND, OK, RequestError, Stop, is_github};
use super::version::{STABLE, Version, channel_of, compare_versions, version_of_tag};

/// A release the Command found: its repository after any rename, its version, and its
/// `SHA256SUMS` when finding the release already downloaded it.
#[derive(Clone, Debug)]
pub(crate) struct Release {
    pub(crate) repository: String,
    pub(crate) version: Version,
    pub(crate) sums: Option<String>,
}

/// The URL a string names, or the foreign error the reference's `new URL` throws for one it cannot
/// parse.
fn parsed(text: &str) -> Result<Url, Stop> {
    Url::parse(text).map_err(|error| {
        Stop::from(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("Invalid URL: {error}"),
        ))
    })
}

/// The owner, name, and tag a github.com tag page's path names, each one nonempty segment.
fn tag_page(path: &str) -> Option<(&str, &str, &str)> {
    let rest = path.strip_prefix('/')?;
    let segments: Vec<&str> = rest.split('/').collect();
    match segments.as_slice() {
        [owner, name, "releases", "tag", tag]
            if !owner.is_empty() && !name.is_empty() && !tag.is_empty() =>
        {
            Some((owner, name, tag))
        }
        _ => None,
    }
}

/// The repository a github.com URL names, as `owner/name`, or `fallback` for another path.
fn repository_of(url: &Url, fallback: &str) -> String {
    let path = url.path();
    let mut segments = path.strip_prefix('/').unwrap_or(path).split('/');
    match (segments.next(), segments.next()) {
        (Some(owner), Some(name)) if !owner.is_empty() && !name.is_empty() => {
            format!("{owner}/{name}")
        }
        _ => fallback.to_owned(),
    }
}

/// Whether two repositories are one, comparing owners and names without regard to case.
fn same_repository(left: &str, right: &str) -> bool {
    left.to_lowercase() == right.to_lowercase()
}

/// The URL of a release's file: `https://github.com/<repository>/releases/download/v<version>/<file>`.
pub(crate) fn download_url(repository: &str, version: &Version, file: &str) -> Result<Url, Stop> {
    parsed(&format!(
        "{GITHUB}/{repository}/releases/download/v{}/{file}",
        version.text
    ))
}

/// A release's `SHA256SUMS` and the repository it came from after any rename.
pub(crate) async fn fetch_sums(
    client: &Client,
    repository: &str,
    version: &Version,
) -> Result<(String, String), Stop> {
    let url = download_url(repository, version, "SHA256SUMS")?;
    let (text, github) = client.fetch_text(&url).await?;
    Ok((repository_of(&github, repository), text))
}

/// The stable release a tag page names, or `None` for a page that is not one.
fn stable_at(page: &Url) -> Option<Release> {
    let (owner, name, tag) = tag_page(page.path())?;
    let version = version_of_tag(tag)?;
    if !is_github(page) || channel_of(&version) != STABLE {
        return None;
    }
    Some(Release {
        repository: format!("{owner}/{name}"),
        version,
        sums: None,
    })
}

/// The newest stable release: the tag page `releases/latest` redirects to, which is not requested.
/// A redirect that leaves github.com, a tag page whose version is not stable, or a `200` at the end
/// of the redirects means there is none; any other status fails the request.
async fn latest_stable(client: &Client, repository: &str) -> Result<Option<Release>, Stop> {
    let start = parsed(&format!("{GITHUB}/{repository}/releases/latest"))?;
    let stop = |location: &Url| !is_github(location) || tag_page(location.path()).is_some();
    match client.follow(&start, stop).await? {
        Followed::Response { response, .. } if response.status != OK => Err(RequestError::Status {
            url: start.as_str().to_owned(),
            status: Some(response.status),
        }
        .into()),
        Followed::Response { .. } => Ok(None),
        Followed::Stopped { stopped, .. } => Ok(stable_at(&stopped)),
    }
}

/// The marker every tag link of the feed starts with.
const FEED_LINK: &str = "href=\"https://github.com/";

/// Each tag page the feed links to, as its owner, name, and tag: an `href` attribute holding
/// `https://github.com/<owner>/<name>/releases/tag/<tag>`, each part free of `/` and `"`.
fn feed_links(feed: &str) -> Vec<(&str, &str, &str)> {
    let mut links = Vec::new();
    let mut rest = feed;
    while let Some(start) = rest.find(FEED_LINK) {
        let after = &rest[start + FEED_LINK.len()..];
        rest = after;
        let Some(end) = after.find('"') else {
            break;
        };
        let segments: Vec<&str> = after[..end].split('/').collect();
        if let [owner, name, "releases", "tag", tag] = segments.as_slice()
            && !owner.is_empty()
            && !name.is_empty()
            && !tag.is_empty()
        {
            links.push((*owner, *name, *tag));
            rest = &after[end + 1..];
        }
    }
    links
}

/// The feed's versions of `repository` on `channel` or `stable`, highest first, and in feed order
/// among equals.
fn feed_versions(feed: &str, repository: &str, channel: &str) -> Vec<Version> {
    let mut versions: Vec<Version> = feed_links(feed)
        .into_iter()
        .filter(|(owner, name, _)| same_repository(&format!("{owner}/{name}"), repository))
        .filter_map(|(_, _, tag)| version_of_tag(tag))
        .filter(|version| {
            let derived = channel_of(version);
            derived == channel || derived == STABLE
        })
        .collect();
    versions.sort_by(|left, right| compare_versions(right, left));
    versions
}

/// The newest release on a prerelease channel: of the feed's tags whose channel is that channel or
/// `stable`, highest first, the first whose `SHA256SUMS` answers `200`. A tag with no release
/// answers `404` and is passed over; any other failure fails the run.
async fn latest_on_channel(
    client: &Client,
    repository: &str,
    channel: &str,
) -> Result<Option<Release>, Stop> {
    let feed = parsed(&format!("{GITHUB}/{repository}/releases.atom"))?;
    let (text, github) = client.fetch_text(&feed).await?;
    let named = repository_of(&github, repository);
    for version in feed_versions(&text, &named, channel) {
        match fetch_sums(client, &named, &version).await {
            Ok((repository, sums)) => {
                return Ok(Some(Release {
                    repository,
                    version,
                    sums: Some(sums),
                }));
            }
            Err(Stop::Request(error)) if error.status() == Some(NOT_FOUND) => {}
            Err(other) => return Err(other),
        }
    }
    Ok(None)
}

/// The newest release on a channel, through `releases/latest` for stable and the feed otherwise.
pub(crate) async fn latest_release(
    client: &Client,
    repository: &str,
    channel: &str,
) -> Result<Option<Release>, Stop> {
    if channel == STABLE {
        latest_stable(client, repository).await
    } else {
        latest_on_channel(client, repository, channel).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_feed_links_each_tag_page_and_skips_other_markup() {
        let feed = concat!(
            r#"<link href="https://github.com/acme/notes/releases"/>"#,
            r#"<link href="https://github.com/acme/notes/releases/tag/v1.0.0"/>"#,
            r#"<content>&lt;a href=&quot;https://github.com/acme/notes/releases/tag/v9.0.0&quot;&gt;</content>"#,
            r#"<link href="https://github.com/other/repo/releases/tag/v2.0.0"/>"#,
        );
        assert_eq!(
            feed_links(feed),
            vec![("acme", "notes", "v1.0.0"), ("other", "repo", "v2.0.0")]
        );
    }

    #[test]
    fn feed_versions_keep_the_channel_and_stable_highest_first() {
        let feed = [
            "v1.7.0-next.1",
            "v1.6.0-beta.1",
            "nightly",
            "v1.6.0",
            "v1.6.0-next.2",
        ]
        .iter()
        .map(|tag| format!(r#"<link href="https://github.com/Acme/Notes/releases/tag/{tag}"/>"#))
        .collect::<String>();
        let versions: Vec<String> = feed_versions(&feed, "acme/notes", "next")
            .into_iter()
            .map(|version| version.text)
            .collect();
        assert_eq!(versions, ["1.7.0-next.1", "1.6.0", "1.6.0-next.2"]);
    }

    #[test]
    fn a_github_url_names_its_repository_or_the_fallback() {
        let url = Url::parse("https://github.com/acme/notes2/releases/download/v1/x")
            .unwrap_or_else(|_| unreachable!("the URL parses"));
        assert_eq!(repository_of(&url, "acme/notes"), "acme/notes2");
        let bare = Url::parse("https://github.com/acme").unwrap_or_else(|_| unreachable!());
        assert_eq!(repository_of(&bare, "acme/notes"), "acme/notes");
    }
}
