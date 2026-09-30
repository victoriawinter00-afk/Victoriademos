/* Floating cart for the storefront list page.
 *
 * It is NOT a second cart. It reads and writes ONLY through window.StoreCart
 * (cart.js), which owns the single `store-cart` localStorage key, and it prices
 * the lines from the same GET /api/products the cart page uses. There is no
 * separate state, so this panel and /cart cannot disagree.
 *
 * Responsive gating is MEASURED, not guessed: the panel is revealed only when
 * the free space to the right of the rendered product grid actually fits it.
 * Below that, it stays absent and /cart remains the only cart. The element
 * starts `hidden`, so it also never appears without JavaScript.
 *
 * The live region (#floating-cart-status) is empty on load and written ONLY on
 * a user-initiated change, so a screen reader is not interrupted when the page
 * opens.
 */
(function () {
    "use strict";

    var PANEL_WIDTH = 260; /* must match .floating-cart width in store.css */
    var EDGE_GAP = 24;     /* viewport margin + required gap from the grid */
    /* Two independent gates. This one is a coarse floor: below 1200px the
       storefront is in its tablet/mobile range (declared breakpoints at 768 and
       480), where a second cart in the corner is intrusive and the cart page is
       the cart. The measured gate below is the precise one and is stricter in
       this layout; both must pass. */
    var MIN_VIEWPORT_WIDTH = 1200;

    var panel = null;
    var itemsList = null;
    var totalEl = null;
    var statusEl = null;
    var actionsLink = null;
    var grid = null;

    var rowCount = 0;
    var removeButtons = [];
    var pendingFocusIndex = null;

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

    /* True only when the viewport is wide enough AND the real, measured free
       space beside the grid can hold the panel with a matching gap on both
       sides. */
    function hasRoom() {
        if (!grid) return false;
        var viewportWidth = document.documentElement.clientWidth;
        if (viewportWidth < MIN_VIEWPORT_WIDTH) return false;
        var free = viewportWidth - grid.getBoundingClientRect().right;
        return free >= PANEL_WIDTH + EDGE_GAP * 2;
    }

    function applyVisibility() {
        if (!panel) return;
        panel.hidden = !(rowCount > 0 && hasRoom());
        /* The stored cart count only matters through the shared module. */
    }

    function buildRow(row) {
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

    function draw(bySlug, announceText) {
        var cart = window.StoreCart;
        if (!cart) return;

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

        /* Mirror the cart page: an item that no longer exists is dropped from
           the one shared store, never merely hidden here. */
        if (dropped > 0) {
            cart.write(kept);
            cart.refreshCount();
        }

        itemsList.textContent = "";
        removeButtons = [];
        var fragment = document.createDocumentFragment();
        rows.forEach(function (row) {
            var node = buildRow(row);
            removeButtons.push(node.querySelector("[data-remove]"));
            fragment.appendChild(node);
        });
        itemsList.appendChild(fragment);

        totalEl.textContent = formatPrice(totalCents, currency);
        rowCount = rows.length;
        applyVisibility();

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
    }

    /* Prices and names come from the same endpoint the cart page reads, so the
       panel can never show a figure the cart page would not. */
    function render(announceText) {
        var cart = window.StoreCart;
        if (!cart || !panel) return;

        if (cart.read().items.length === 0) {
            itemsList.textContent = "";
            removeButtons = [];
            rowCount = 0;
            applyVisibility();
            return;
        }

        fetch("/api/products", { headers: { accept: "application/json" } })
            .then(function (response) {
                if (!response.ok) throw new Error("Server returned " + response.status + ".");
                return response.json();
            })
            .then(function (data) {
                var bySlug = Object.create(null);
                ((data && data.products) || []).forEach(function (product) {
                    bySlug[product.slug] = product;
                });
                draw(bySlug, announceText);
            })
            .catch(function () {
                /* No trustworthy prices: stay hidden rather than show a wrong total. */
                rowCount = 0;
                applyVisibility();
            });
    }

    function onRemoveClick(event) {
        var button = event.target.closest ? event.target.closest("[data-remove]") : null;
        if (!button) return;
        var cart = window.StoreCart;
        var slug = button.getAttribute("data-remove");
        if (!cart || !slug) return;

        pendingFocusIndex = Array.prototype.indexOf.call(removeButtons, button);
        cart.remove(slug);
        render("Item removed.");
    }

    /* The grid's own click handler (store.js) adds to the cart first, then the
       event bubbles here, so this re-reads the already-updated cart. */
    function onCardAddClick(event) {
        var button = event.target.closest ? event.target.closest("[data-card-add]") : null;
        if (!button || button.disabled) return;
        render("Cart updated.");
    }

    function init() {
        if (document.body.getAttribute("data-page") !== "list") return;

        panel = document.getElementById("floating-cart");
        if (!panel) return;
        itemsList = document.getElementById("floating-cart-items");
        totalEl = document.getElementById("floating-cart-total");
        statusEl = document.getElementById("floating-cart-status");
        actionsLink = panel.querySelector(".floating-cart__actions a");
        grid = document.getElementById("product-list");
        if (!itemsList || !totalEl || !statusEl || !grid) return;

        itemsList.addEventListener("click", onRemoveClick);
        document.addEventListener("click", onCardAddClick);

        var resizeTimer = null;
        window.addEventListener("resize", function () {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(applyVisibility, 150);
        });

        /* Initial render is silent: no announcement on page load. */
        render();
    }

    document.addEventListener("DOMContentLoaded", init);
})();
