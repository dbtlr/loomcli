class LoomNotes < Formula
  desc "Manage release notes"
  homepage "https://github.com/fixture/loom-notes"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/fixture/loom-notes/releases/download/v1.4.0/loom-notes-darwin-arm64"
      sha256 "9ae9b9a749ebc6dfa5f23bf7de22842354e7bba255a096ecccd6470e24df85b8"
    end
    on_intel do
      url "https://github.com/fixture/loom-notes/releases/download/v1.4.0/loom-notes-darwin-x64"
      sha256 "71de85fdcc062c1dca63c49827c46144a8f26d996f4d97f253cf322edc5fd810"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/fixture/loom-notes/releases/download/v1.4.0/loom-notes-linux-arm64"
      sha256 "460ecafe42c68d9301946f5f55faf19583a9b63c6378f766e7eb267f375c6794"
    end
    on_intel do
      url "https://github.com/fixture/loom-notes/releases/download/v1.4.0/loom-notes-linux-x64"
      sha256 "108d3e2bbf34c32a3ff6fa9f0c7ab9cc58c1cb5291152f3248ee7b313ab516d3"
    end
  end

  # Keep the release version if Homebrew infers a different one from the asset URL.
  version "1.4.0" if version.to_s != "1.4.0"

  def install
    asset = File.basename(stable.url)
    chmod 0755, asset
    bin.install asset => "loom-notes"
  end

  test do
    system bin/"loom-notes", "--version"
  end
end
