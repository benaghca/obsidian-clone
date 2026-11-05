// TEST ONLY. LD_PRELOAD shim: when the kernel refuses DRM_IOCTL_WAIT_VBLANK
// (nvidia_drm vblank=0), emulate a free-running vblank at SHIM_HZ so WebKit's
// DisplayVBlankMonitorDRM runs instead of its fixed 60 Hz timer. It stands in
// for what nvidia_drm.vblank=1 would give, to see what WebKit does with it.
#define _GNU_SOURCE
#include <xf86drm.h>
#include <dlfcn.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
static int (*real)(int, drmVBlankPtr);
int drmWaitVBlank(int fd, drmVBlankPtr vbl) {
  if (!real) real = dlsym(RTLD_NEXT, "drmWaitVBlank");
  unsigned type = vbl->request.type, want = vbl->request.sequence;
  int ret = real(fd, vbl);
  if (!(ret && errno == EOPNOTSUPP)) return ret;
  static double period; static int logged;
  if (!period) { const char *hz = getenv("SHIM_HZ"); period = 1.0 / (hz ? atof(hz) : 239.97); }
  if (!logged++) fprintf(stderr, "vblankshim: emulating %.2f Hz vblank\n", 1.0 / period);
  struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
  double now = ts.tv_sec + ts.tv_nsec / 1e9;
  unsigned long seq = (unsigned long)(now / period);
  if (type & DRM_VBLANK_RELATIVE) seq += want; else if (want > seq) seq = want;
  double at = seq * period;
  if (at > now) {
    struct timespec t = { (time_t)at, (long)((at - (time_t)at) * 1e9) };
    clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &t, NULL);
  }
  vbl->reply.sequence = (unsigned)seq;
  vbl->reply.tval_sec = (long)at;
  vbl->reply.tval_usec = (long)((at - (long)at) * 1e6);
  errno = 0;
  return 0;
}
