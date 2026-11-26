//! Names the OS errors seen at child start in the form the reference reports.

use std::io;

#[cfg(unix)]
pub(super) fn start_code(error: &io::Error) -> Option<String> {
    use rustix::io::Errno;

    let raw = error.raw_os_error()?;
    let name = match Errno::from_io_error(error) {
        Some(Errno::ACCESS) => "EACCES",
        Some(Errno::NOENT) => "ENOENT",
        Some(Errno::NOEXEC) => "ENOEXEC",
        Some(Errno::TOOBIG) => "E2BIG",
        Some(Errno::AGAIN) => "EAGAIN",
        Some(Errno::BADF) => "EBADF",
        Some(Errno::BUSY) => "EBUSY",
        Some(Errno::FAULT) => "EFAULT",
        Some(Errno::INTR) => "EINTR",
        Some(Errno::INVAL) => "EINVAL",
        Some(Errno::IO) => "EIO",
        Some(Errno::ISDIR) => "EISDIR",
        Some(Errno::LOOP) => "ELOOP",
        Some(Errno::MFILE) => "EMFILE",
        Some(Errno::NAMETOOLONG) => "ENAMETOOLONG",
        Some(Errno::NFILE) => "ENFILE",
        Some(Errno::NODEV) => "ENODEV",
        Some(Errno::NOMEM) => "ENOMEM",
        Some(Errno::NOSPC) => "ENOSPC",
        Some(Errno::NOSYS) => "ENOSYS",
        Some(Errno::NOTDIR) => "ENOTDIR",
        Some(Errno::NOTSUP) => "ENOTSUP",
        Some(Errno::OVERFLOW) => "EOVERFLOW",
        Some(Errno::PERM) => "EPERM",
        Some(Errno::PIPE) => "EPIPE",
        Some(Errno::ROFS) => "EROFS",
        Some(Errno::TXTBSY) => "ETXTBSY",
        _ => return Some(format!("Unknown system error {}", -i64::from(raw))),
    };
    Some(name.to_owned())
}

#[cfg(windows)]
pub(super) fn start_code(error: &io::Error) -> Option<String> {
    Some(win32_error_name(error.raw_os_error()?).to_owned())
}

#[cfg_attr(
    not(any(windows, test)),
    expect(dead_code, reason = "used on Windows and in tests")
)]
fn win32_error_name(raw: i32) -> &'static str {
    // Win32 error numbers and their libuv names in uv_translate_sys_error.
    match raw {
        1 => "EISDIR",
        2 | 3 | 15 | 123 | 126 | 161 | 203 | 267 | 4392 => "ENOENT",
        4 => "EMFILE",
        5 | 1314 => "EPERM",
        6 | 1004 => "EBADF",
        8 | 14 => "ENOMEM",
        13 | 87 | 122 => "EINVAL",
        17 => "EXDEV",
        19 => "EROFS",
        23 | 31 | 110 | 1117 | 1393 => "EIO",
        32 | 33 | 231 => "EBUSY",
        39 | 82 | 112 => "ENOSPC",
        50 => "ENOTSUP",
        111 | 206 => "ENAMETOOLONG",
        121 => "ETIMEDOUT",
        193 => "EFTYPE",
        208 => "E2BIG",
        740 | 1920 => "EACCES",
        995 => "ECANCELED",
        1113 => "ECHARSET",
        1921 => "ELOOP",
        _ => "UNKNOWN",
    }
}

#[cfg(not(any(unix, windows)))]
pub(super) fn start_code(error: &io::Error) -> Option<String> {
    error.raw_os_error().map(|_| "UNKNOWN".to_owned())
}

#[cfg(test)]
mod tests {
    use super::win32_error_name;

    #[test]
    fn win32_spawn_errors_use_libuv_names() {
        assert_eq!(win32_error_name(2), "ENOENT");
        assert_eq!(win32_error_name(5), "EPERM");
        assert_eq!(win32_error_name(193), "EFTYPE");
        assert_eq!(win32_error_name(740), "EACCES");
        assert_eq!(win32_error_name(1393), "EIO");
        assert_eq!(win32_error_name(1392), "UNKNOWN");
        assert_eq!(win32_error_name(i32::MAX), "UNKNOWN");
    }
}
