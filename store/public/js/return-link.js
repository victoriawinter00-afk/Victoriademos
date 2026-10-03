/* Floating "return to the consultation website" link for the storefront.
 *
 * This mirrors the visibility mechanics of the floating "view cart" button in
 * floating-cart.js, deliberately: the same zero-size guard, the same
 * "is it inside the viewport" test (rect.bottom > 0 && rect.top < innerHeight),
 * the same "can it ever leave the viewport" gate, the same rAF-throttled scroll
 * handler, and the same debounced resize handler. The only difference is what
 * it watches - the new-tab note near the top of the page rather than the cart.
 *
 * The control is a real <a href="https://www.victoriawinter00.com/">, so it
 * navigates with no script of its own; the script only decides when to reveal
 * it. It is NOT gated on the cart: it appears whether or not anything is in the
 * cart. It sits at the fixed bottom-right base position, and lifts the cart
 * button above itself via the `--return-fab-offset` custom property so the two
 * controls can never overlap.
 */
(function () {
    "use strict";

    var note = null;
    var link = null;

    /* Same guard the cart uses: an element with no box has no geometry to read. */
    function noteVisible() {
        if (!note) return false;
        var rect = note.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return rect.bottom > 0 && rect.top < window.innerHeight;
    }

    /* The gate must not be able to hide the link forever. On a page too short to
       scroll the note away, the note is permanently on screen, so the link is a
       harmless extra affordance and is not gated. */
    function noteCanLeaveViewport() {
        if (!note) return false;
        var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        var noteBottom = note.getBoundingClientRect().bottom + window.scrollY;
        return maxScroll > noteBottom;
    }

    function sync() {
        if (!link) return;
        var gated = noteCanLeaveViewport() && noteVisible();
        var visible = !gated;
        link.hidden = !visible;

        if (visible) {
            /* Reserve the link's measured height above the base position so the
               cart button is lifted clear of it. */
            var height = link.offsetHeight || 0;
            document.documentElement.style.setProperty("--return-fab-offset", height + 12 + "px");
        } else {
            document.documentElement.style.removeProperty("--return-fab-offset");
        }
    }

    function init() {
        note = document.getElementById("store-return-note");
        link = document.getElementById("return-fab");
        if (!note || !link) return;

        var resizeTimer = null;
        window.addEventListener("resize", function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(sync, 150);
        });

        /* One geometry read per frame; it never fetches. */
        var scrollScheduled = false;
        window.addEventListener("scroll", function () {
            if (scrollScheduled) return;
            scrollScheduled = true;
            window.requestAnimationFrame(function () {
                scrollScheduled = false;
                sync();
            });
        }, { passive: true });

        /* Silent on load: the note is on screen at the top, so no affordance
           appears until it has scrolled away. */
        sync();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
