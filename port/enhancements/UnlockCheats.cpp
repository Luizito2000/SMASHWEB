#include "enhancements.h"

#include <libultraship/bridge/consolevariablebridge.h>

extern "C" {
    int port_cheat_unlock_all() {
#if defined(__WEB__)
        // Smash Web is intended as a ready-to-play vanilla build.  Keep every
        // original unlock available even with a fresh (or older) browser save:
        // Luigi, Ness, Captain Falcon, Jigglypuff, Mushroom Kingdom, Sound
        // Test, and Item Switch.  The original desktop toggle remains intact.
        return 1;
#else
        return CVarGetInteger("gCheats.UnlockAll", 0);
#endif
    }
    int port_cheat_unlock_luigi()      { return CVarGetInteger("gCheats.UnlockLuigi", 0); }
    int port_cheat_unlock_ness()       { return CVarGetInteger("gCheats.UnlockNess", 0); }
    int port_cheat_unlock_captain()    { return CVarGetInteger("gCheats.UnlockCaptain", 0); }
    int port_cheat_unlock_purin()      { return CVarGetInteger("gCheats.UnlockPurin", 0); }
    int port_cheat_unlock_inishie()    { return CVarGetInteger("gCheats.UnlockInishie", 0); }
    int port_cheat_unlock_soundtest()  { return CVarGetInteger("gCheats.UnlockSoundTest", 0); }
    int port_cheat_unlock_itemswitch() { return CVarGetInteger("gCheats.UnlockItemSwitch", 0); }
}
