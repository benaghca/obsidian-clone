// Mirrors WebKit's DisplayVBlankMonitorDRM::create: find the CRTC driving a
// connector, then ask for the next vblank on it.
#include <xf86drm.h>
#include <xf86drmMode.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <time.h>
int main(int argc, char **argv) {
  const char *node = argc > 1 ? argv[1] : "/dev/dri/card1";
  int fd = open(node, O_RDWR | O_CLOEXEC);
  if (fd < 0) { perror("open"); return 1; }
  drmModeRes *res = drmModeGetResources(fd);
  if (!res) { perror("resources"); return 1; }
  for (int i = 0; i < res->count_connectors; i++) {
    drmModeConnector *c = drmModeGetConnector(fd, res->connectors[i]);
    if (!c || c->connection != DRM_MODE_CONNECTED || !c->encoder_id) continue;
    drmModeEncoder *e = drmModeGetEncoder(fd, c->encoder_id);
    int idx = -1;
    for (int j = 0; j < res->count_crtcs; j++) if (res->crtcs[j] == e->crtc_id) idx = j;
    drmModeCrtc *crtc = drmModeGetCrtc(fd, e->crtc_id);
    printf("connector %u type %u-%u crtc %u index %d mode %s vrefresh %u clock %u htotal %u vtotal %u\n",
      c->connector_id, c->connector_type, c->connector_type_id, e->crtc_id, idx,
      crtc->mode.name, crtc->mode.vrefresh, crtc->mode.clock, crtc->mode.htotal, crtc->mode.vtotal);
    drmVBlank vbl; memset(&vbl, 0, sizeof vbl);
    vbl.request.type = DRM_VBLANK_RELATIVE | ((idx << DRM_VBLANK_HIGH_CRTC_SHIFT) & DRM_VBLANK_HIGH_CRTC_MASK);
    vbl.request.sequence = 1;
    errno = 0;
    int ret = drmWaitVBlank(fd, &vbl);
    printf("drmWaitVBlank ret=%d errno=%d (%s); strerror(-ret)=%s\n", ret, errno, strerror(errno), strerror(-ret));
  }
  return 0;
}
