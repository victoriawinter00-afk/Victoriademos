/* "Return to top" control for the page foot.
 *
 * This is a NEW component. The consulting site has no return-to-top control
 * (no scrollTo, no #top anchor, no sticky control), so nothing was ported.
 *
 * It is a real button rather than a link to a missing anchor, and it is wired to
 * every [data-to-top] in the document, so it works on any page the control is
 * added to. Smooth scrolling is requested by default and downgraded to an
 * instant jump when the visitor asks for reduced motion; the explicit check is
 * needed because a JS `behavior: "smooth"` is not overridden by the CSS
 * `scroll-behavior` from the prefers-reduced-motion block.
 */
(function () {
    "use strict";

    function reduceMotion() {
        return Boolean(
            window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
    }

    function init() {
        var buttons = document.querySelectorAll("[data-to-top]");
        if (!buttons.length) return;

        var main = document.getElementById("main-content");

        Array.prototype.forEach.call(buttons, function (button) {
            button.addEventListener("click", function () {
                window.scrollTo({
                    top: 0,
                    left: 0,
                    behavior: reduceMotion() ? "auto" : "smooth"
                });

                /* Keep keyboard and screen-reader continuity: move focus to the
                   top of the page without fighting the scroll. */
                if (main) {
                    if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
                    main.focus({ preventScroll: true });
                }
            });
        });
    }

    document.addEventListener("DOMContentLoaded", init);
})();
