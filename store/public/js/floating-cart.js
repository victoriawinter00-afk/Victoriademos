/* Floating cart affordances for the storefront.
 *
 * Two affordances, ONE owner, one decision, so they can never both show:
 *
 *   - the PANEL (index.html only), fixed to the right of the product grid, used
 *     where it has genuine measured room;
 *   - the BUTTON (this page and product.html), a fixed bottom-right link, used
 *     everywhere else.
 *
 * Cart state is NOT owned here. Everything reads and writes window.StoreCart
 * (cart.js), which owns the single `store-cart` localStorage key, and the count
 * is the existing `[data-cart-count]` span that cart.js already maintains - so
 * there is no second source of truth and the button, the panel and /cart cannot
 * disagree. The button is a real <a href="/cart">, so it navigates without any
 * script of its own.
 *
 * The live region (#floating-cart-status) is empty on load and written only on a
 * user-initiated change, so a screen reader is not interrupted when the page
 * opens.
 */
(function () {
    "use strict";

    var PANEL_WIDTH = 260; /* must match .floating-cart width in store.css */
    var EDGE_GAP = 24;     /* viewport margin + required gap from the grid */
    /* A coarse floor for the panel only: below 1200px the storefront is in its
       tablet/mobile range (breakpoints at 768 and 480), where a corner panel is
       intrusive and the button is the right affordance. The measured gate below
       is the precise one and is stricter in this layout; both must pass. */
    var MIN_VIEWPORT_WIDTH = 1200;

    var panel = null;
    var fab = null;
    var itemsList = null;
    var totalEl = null;
    var statusEl = null;
    var actionsLink = null;
    var grid = null;
    var headerCartLink = null;

    var rowCount = 0;
    var removeButtons = [];
    var pendingFocusIndex = null;
    var panelRequest = 0;

    function formatPrice(cents, currency) {
        if (cents === 0) return "Free";
        try {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: (currency || "usd").toUpperCase()
            }).format(cents / 100);
        } catch (err) {
            return (cents / 100).toFixed(2);
        }
    }

    function currentCount() {
        return window.StoreCart ? window.StoreCart.count() : 0;
    }

    /* True only when the viewport is wide enough AND the measured free space
       beside the rendered grid can hold the panel with a matching gap. */
    function hasRoom() {
        if (!panel || !grid) return false;
        var viewportWidth = document.documentElement.clientWidth;
        if (viewportWidth < MIN_VIEWPORT_WIDTH) return false;
        var free = viewportWidth - grid.getBoundingClientRect().right;
        return free >= PANEL_WIDTH + EDGE_GAP * 2;
    }

    function setFab(visible) {
        if (!fab) return;
        var count = currentCount();
        fab.hidden = !visible;
        if (visible) {
            fab.setAttribute(
                "aria-label",
                "View cart, " + count + (count === 1 ? " item" : " items")
            );
        }
    }

    /* The header's own cart link is the page's permanent affordance. It scrolls
       away - that is the whole reason this button exists - so the button appears
       only once the header link has left the viewport. That keeps exactly one
       cart control reachable at every scroll position, and at the top of the
       page it keeps the button out of the band where the wrapped filter row can
       come to rest under it. */
    function headerCartVisible() {
        if (!headerCartLink) return false;
        var rect = headerCartLink.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return rect.bottom > 0 && rect.top < window.innerHeight;
    }

    /* The gate must not be able to hide the button forever. On a page too short
       to scroll the header link away, the link is permanently on screen, so the
       button is a harmless extra affordance and is not gated. */
    function headerLinkCanLeaveViewport() {
        if (!headerCartLink) return false;
        var maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        var linkBottom = headerCartLink.getBoundingClientRect().bottom + window.scrollY;
        return maxScroll > linkBottom;
    }

    /* Cheap, scroll-safe: it reads geometry only, never the product API. */
    function syncFab() {
        if (!fab) return;
        var count = currentCount();
        var panelShown = Boolean(panel && !panel.hidden);
        var gated = headerLinkCanLeaveViewport() && headerCartVisible();
        setFab(count > 0 && !panelShown && !gated);
    }

    function buildPanelRow(row) {
        var li = document.createElement("li");
        li.className = "floating-cart__item";

        var name = document.createElement("p");
        name.className = "floating-cart__name";
        var link = document.createElement("a");
        link.href = "/product/" + encodeURIComponent(row.product.slug);
        link.textContent = row.product.name;
        name.appendChild(link);

        var meta = document.createElement("p");
        meta.className = "floating-cart__meta";
        meta.textContent = "Qty " + row.quantity;

        var line = document.createElement("p");
        line.className = "floating-cart__line";
        line.textContent = formatPrice(row.product.price_cents * row.quantity, row.product.currency);

        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "floating-cart__remove";
        remove.setAttribute("data-remove", row.product.slug);
        remove.setAttribute("aria-label", "Remove " + row.product.name + " from cart");
        remove.textContent = "Remove";

        li.appendChild(name);
        li.appendChild(meta);
        li.appendChild(line);
        li.appendChild(remove);
        return li;
    }

    function hidePanel() {
        if (!panel) return;
        panel.hidden = true;
        itemsList.textContent = "";
        removeButtons = [];
        rowCount = 0;
    }

    /* Draws the panel. On any failure it yields to the button rather than
       leaving the customer with no way to reach the cart. */
    function drawPanel(announceText) {
        var cart = window.StoreCart;
        if (!cart || !panel) return;

        var request = ++panelRequest;
        if (cart.read().items.length === 0) {
            hidePanel();
            setFab(false);
            return;
        }

        fetch("/api/products", { headers: { accept: "application/json" } })
            .then(function (response) {
                if (!response.ok) throw new Error("Server returned " + response.status + ".");
                return response.json();
            })
            .then(function (data) {
                if (request !== panelRequest) return;

                var bySlug = Object.create(null);
                ((data && data.products) || []).forEach(function (product) {
                    bySlug[product.slug] = product;
                });

                var stored = cart.read();
                var rows = [];
                var kept = [];
                var dropped = 0;
                var totalCents = 0;
                var currency = "usd";

                stored.items.forEach(function (item) {
                    var product = bySlug[item.slug];
                    if (!product) {
                        dropped += 1;
                        return;
                    }
                    kept.push(item);
                    rows.push({ product: product, quantity: item.quantity });
                    totalCents += product.price_cents * item.quantity;
                    currency = product.currency || "usd";
                });

                /* Mirror the cart page: an item that no longer exists is dropped
                   from the one shared store, never merely hidden here. */
                if (dropped > 0) {
                    cart.write(kept);
                    cart.refreshCount();
                }

                if (rows.length === 0) {
                    hidePanel();
                    syncFab();
                    return;
                }

                itemsList.textContent = "";
                removeButtons = [];
                var fragment = document.createDocumentFragment();
                rows.forEach(function (row) {
                    var node = buildPanelRow(row);
                    removeButtons.push(node.querySelector("[data-remove]"));
                    fragment.appendChild(node);
                });
                itemsList.appendChild(fragment);

                totalEl.textContent = formatPrice(totalCents, currency);
                rowCount = rows.length;
                panel.hidden = false;
                setFab(false);

                if (pendingFocusIndex !== null) {
                    var target = removeButtons[Math.min(pendingFocusIndex, removeButtons.length - 1)];
                    if (target) target.focus();
                    else if (actionsLink) actionsLink.focus();
                    pendingFocusIndex = null;
                }

                var message = announceText || "";
                if (dropped > 0) {
                    var note = dropped === 1
                        ? "1 item was removed because it is no longer available."
                        : dropped + " items were removed because they are no longer available.";
                    message = [message, note].filter(Boolean).join(" ");
                }
                if (message) {
                    statusEl.textContent = message + " Cart total " + totalEl.textContent + ".";
                }
            })
            .catch(function () {
                if (request !== panelRequest) return;
                hidePanel();
                /* No trustworthy prices: never show a wrong total, but do give
                   the customer a way to the cart. */
                syncFab();
            });
    }

    /* The single decision. Exactly one affordance is visible, or neither. */
    function update(announceText) {
        var count = currentCount();

        if (count === 0) {
            hidePanel();
            setFab(false);
            return;
        }

        if (hasRoom()) {
            setFab(false);
            drawPanel(announceText);
            return;
        }

        hidePanel();
        syncFab();
    }

    function onPanelRemoveClick(event) {
        var button = event.target.closest ? event.target.closest("[data-remove]") : null;
        if (!button) return;
        var cart = window.StoreCart;
        var slug = button.getAttribute("data-remove");
        if (!cart || !slug) return;

        pendingFocusIndex = Array.prototype.indexOf.call(removeButtons, button);
        cart.remove(slug);
        update("Item removed.");
    }

    /* store.js adds to the cart during this same click. The deferral means we
       never depend on which listener ran first. */
    function onDocumentClick(event) {
        var target = event.target;
        if (!target || !target.closest) return;
        var control = target.closest("[data-card-add]") || target.closest("#detail-add");
        if (!control || control.disabled) return;
        window.setTimeout(function () {
            update("Cart updated.");
        }, 0);
    }

    function init() {
        var page = document.body.getAttribute("data-page");
        if (page !== "list" && page !== "detail") return;

        panel = document.getElementById("floating-cart");
        fab = document.getElementById("view-cart-fab");
        headerCartLink = document.querySelector('.store-nav a[href="/cart"]');

        if (panel) {
            itemsList = document.getElementById("floating-cart-items");
            totalEl = document.getElementById("floating-cart-total");
            statusEl = document.getElementById("floating-cart-status");
            actionsLink = panel.querySelector(".floating-cart__actions a");
            grid = document.getElementById("product-list");
            if (!itemsList || !totalEl || !statusEl) {
                panel = null;
            }
        }

        if (!panel && !fab) return;

        if (panel) {
            itemsList.addEventListener("click", onPanelRemoveClick);
        }
        document.addEventListener("click", onDocumentClick);

        var resizeTimer = null;
        window.addEventListener("resize", function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(function () {
                update();
            }, 150);
        });

        /* The button's visibility depends on whether the header link is still on
           screen, so re-check on scroll. Throttled to one geometry read per
           frame; it never fetches. */
        var scrollScheduled = false;
        window.addEventListener("scroll", function () {
            if (scrollScheduled) return;
            scrollScheduled = true;
            window.requestAnimationFrame(function () {
                scrollScheduled = false;
                syncFab();
            });
        }, { passive: true });

        /* Silent on load: nothing is announced until the customer acts, and no
           affordance appears when the cart is empty. */
        update();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
