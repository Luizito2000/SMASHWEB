#include "enhancements.h"
#include <libultraship/bridge/consolevariablebridge.h>

namespace ssb64 {
    namespace enhancements {

        const char* BootToVSCSSCVarName() {
            return "gEnhancements.BootToVSCSS";
        }

    } // namespace enhancements
} // namespace ssb64

extern "C" int port_enhancement_boot_to_vs_css(void) {
#if defined(__EMSCRIPTEN__)
    // The browser build must follow the original boot flow (title -> mode
    // select -> 1P/VS).  Skipping directly to the VS character screen makes
    // the web version look unlike the vanilla game and bypasses the 1P menu.
    return 0;
#else
    return CVarGetInteger(ssb64::enhancements::BootToVSCSSCVarName(), 0) != 0;
#endif
}
