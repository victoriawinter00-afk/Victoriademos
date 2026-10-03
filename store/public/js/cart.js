/* Cart storage and cart-page rendering.

   The stored shape is exactly [{ slug, quantity }] - never prices.
   Every value read from localStorage is treated as attacker-controlled: it is
   validated and normalized before use, and the cleaned form is written back.
   This module is a display layer. It is not a security boundary, and nothing it
   holds may be trusted by the server at checkout. */
(function () {
    "use strict";

    var KEY = "store-cart";
    var MAX_QTY = 99;
    var SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

    function isSlug(value) {
        return typeof value === "string" && SLUG_PATTERN.test(value);
    }

    function isQuantity(value) {
        return (
            typeof value === "number" &&
            isFinite(value) &&
            Math.floor(value) === value &&
            value >= 1
        );
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

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

    /* Normalise untrusted storage into a known-good list. */
    function sanitise(raw) {
        var quantities = Object.create(null);
        var order = [];
        var invalidCount = 0;

        if (!Array.isArray(raw)) {
            if (raw !== null && raw !== undefined) invalidCount = 1;
            return { items: [], invalidCount: invalidCount };
        }

        raw.forEach(function (entry) {
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                invalidCount += 1;
                return;
            }
            if (!isSlug(entry.slug) || !isQuantity(entry.quantity)) {
                invalidCount += 1;
                return;
            }
            var quantity = Math.min(entry.quantity, MAX_QTY);
            if (Object.prototype.hasOwnProperty.call(quantities, entry.slug)) {
                quantities[entry.slug] = Math.min(quantities[entry.slug] + quantity, MAX_QTY);
                return;
            }
            quantities[entry.slug] = quantity;
            order.push(entry.slug);
        });

        return {
            items: order.map(function (slug) {
                return { slug: slug, quantity: quantities[slug] };
            }),
            invalidCount: invalidCount
        };
    }

    function write(items) {
        var clean = items.map(function (item) {
            return { slug: item.slug, quantity: item.quantity };
        });
        try {
            window.localStorage.setItem(KEY, JSON.stringify(clean));
        } catch (err) {
            /* Storage unavailable: the cart just will not persist. */
        }
        return clean;
    }

    /* Returns { items, invalidCount }. Bad data is discarded, never trusted. */
    function read() {
        var text = null;
        try {
            text = window.localStorage.getItem(KEY);
        } catch (err) {
            return { items: [], invalidCount: 0 };
        }
        if (text === null) return { items: [], invalidCount: 0 };

        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (err) {
            write([]);
            return { items: [], invalidCount: 1 };
        }

        var result = sanitise(parsed);
        if (result.invalidCount > 0) {
            write(result.items);
        }
        return result;
    }

    function count() {
        return read().items.reduce(function (sum, item) {
            return sum + item.quantity;
        }, 0);
    }

    function refreshCount() {
        var total = count();
        var nodes = document.querySelectorAll("[data-cart-count]");
        Array.prototype.forEach.call(nodes, function (node) {
            node.textContent = String(total);
        });
    }

    function add(slug, quantity) {
        if (!isSlug(slug)) return null;
        var amount = isQuantity(quantity) ? quantity : 1;
        var items = read().items;
        var existing = null;
        items.forEach(function (item) {
            if (item.slug === slug) existing = item;
        });
        if (existing) {
            existing.quantity = Math.min(existing.quantity + amount, MAX_QTY);
        } else {
            items.push({ slug: slug, quantity: Math.min(amount, MAX_QTY) });
        }
        write(items);
        refreshCount();
        return existing ? existing.quantity : amount;
    }

    function setQuantity(slug, quantity) {
        if (!isSlug(slug)) return;
        var requested = Math.floor(quantity);
        if (!isFinite(requested) || requested < 1) requested = 1;
        if (requested > MAX_QTY) requested = MAX_QTY;
        var next = read().items.map(function (item) {
            return item.slug === slug
                ? { slug: item.slug, quantity: requested }
                : item;
        });
        write(next);
        refreshCount();
    }

    function remove(slug) {
        var next = read().items.filter(function (item) {
            return item.slug !== slug;
        });
        write(next);
        refreshCount();
    }

    /* Empties the cart. Called only when an order is CONFIRMED to exist - never
       on page load, or someone who abandons checkout and comes back would lose
       the selection they were still deciding on. */
    function clear() {
        write([]);
        refreshCount();
    }

    /* ---- Cart page ------------------------------------------------------- */

    var listElement = null;
    var pendingFocus = null;
    var lastRows = [];
    var checkoutRequestId = uuid4();

    function uuid4() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        var bytes = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(bytes);
        } else {
            for (var i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
        }
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        var hex = "";
        for (var j = 0; j < 16; j += 1) hex += (bytes[j] + 0x100).toString(16).slice(1);
        return (
            hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
            hex.slice(16, 20) + "-" + hex.slice(20, 32)
        );
    }

    function statusElement() {
        return document.getElementById("cart-status");
    }

    function announce(text) {
        var status = statusElement();
        if (status) status.textContent = text;
    }

    function applyPendingFocus() {
        if (!pendingFocus) return;
        var target = document.querySelector(
            '[data-action="' + pendingFocus.action + '"][data-slug="' + pendingFocus.slug + '"]'
        );
        if (target && !target.disabled) {
            pendingFocus = null;
            target.focus();
            return;
        }
        var fallback = document.querySelector(
            '[data-action="remove"][data-slug="' + pendingFocus.slug + '"]'
        );
        pendingFocus = null;
        if (fallback && !fallback.disabled) {
            fallback.focus();
            return;
        }
        var status = statusElement();
        if (status) status.focus();
    }

    function buildRow(product, quantity) {
        var row = el("li", "cart-item");

        var info = el("div", "cart-item__info");
        if (product.category) {
            info.appendChild(el("p", "cart-item__category", product.category));
        }
        var heading = el("h2", "cart-item__name");
        var link = el("a", null, product.name);
        link.href = "/product/" + encodeURIComponent(product.slug);
        heading.appendChild(link);
        info.appendChild(heading);
        info.appendChild(
            el("p", "cart-item__unit", formatPrice(product.price_cents, product.currency) + " each")
        );
        if (product.type === "physical" && !product.in_stock) {
            info.appendChild(el("span", "badge badge--out", "Out of stock"));
            info.appendChild(
                el(
                    "p",
                    "cart-item__note",
                    "Out of stock. Availability is confirmed when the order is placed."
                )
            );
        }
        row.appendChild(info);

        var controls = el("div", "cart-item__controls");

        var qtyGroup = el("div", "qty-control");
        qtyGroup.setAttribute("role", "group");
        qtyGroup.setAttribute("aria-label", "Quantity for " + product.name);

        var decrease = el("button", "qty-btn", "\u2212");
        decrease.type = "button";
        decrease.setAttribute("data-action", "dec");
        decrease.setAttribute("data-slug", product.slug);
        decrease.setAttribute("aria-label", "Decrease quantity of " + product.name);
        if (quantity <= 1) decrease.disabled = true;
        qtyGroup.appendChild(decrease);

        qtyGroup.appendChild(el("span", "qty-value", String(quantity)));

        var increase = el("button", "qty-btn", "+");
        increase.type = "button";
        increase.setAttribute("data-action", "inc");
        increase.setAttribute("data-slug", product.slug);
        increase.setAttribute("aria-label", "Increase quantity of " + product.name);
        if (quantity >= MAX_QTY) increase.disabled = true;
        qtyGroup.appendChild(increase);

        controls.appendChild(qtyGroup);
        controls.appendChild(
            el("p", "cart-item__line", formatPrice(product.price_cents * quantity, product.currency))
        );

        var removeButton = el("button", "cart-item__remove", "Remove");
        removeButton.type = "button";
        removeButton.setAttribute("data-action", "remove");
        removeButton.setAttribute("data-slug", product.slug);
        removeButton.setAttribute("aria-label", "Remove " + product.name + " from cart");
        controls.appendChild(removeButton);

        row.appendChild(controls);
        return row;
    }

    function drawNotices(invalidCount, unavailableCount) {
        var parts = [];
        if (invalidCount > 0) {
            parts.push(
                invalidCount === 1
                    ? "1 invalid cart entry was discarded."
                    : invalidCount + " invalid cart entries were discarded."
            );
        }
        if (unavailableCount > 0) {
            parts.push(
                unavailableCount === 1
                    ? "1 item was removed because it is no longer available."
                    : unavailableCount + " items were removed because they are no longer available."
            );
        }
        return parts.join(" ");
    }

    function drawItems(rows) {
        var list = document.getElementById("cart-items");
        var empty = document.getElementById("cart-empty");
        var summary = document.getElementById("cart-summary");
        if (!list || !empty || !summary) return;

        list.textContent = "";

        if (rows.length === 0) {
            empty.hidden = false;
            summary.hidden = true;
            return;
        }

        empty.hidden = true;
        summary.hidden = false;

        var totalCents = 0;
        var itemCount = 0;
        var needsShipping = false;
        var fragment = document.createDocumentFragment();

        rows.forEach(function (row) {
            totalCents += row.product.price_cents * row.quantity;
            itemCount += row.quantity;
            if (row.product.type === "physical") needsShipping = true;
            fragment.appendChild(buildRow(row.product, row.quantity));
        });
        list.appendChild(fragment);

        document.getElementById("cart-count-line").textContent =
            itemCount === 1 ? "1 item" : itemCount + " items";
        document.getElementById("cart-total").textContent = formatPrice(
            totalCents,
            rows[0].product.currency
        );

        var shipping = document.getElementById("cart-shipping");
        if (needsShipping) {
            shipping.hidden = false;
            shipping.textContent =
                "Shipping applies: this cart contains physical items. The rate is worked out at checkout.";
        } else {
            shipping.hidden = true;
            shipping.textContent = "";
        }

        applyPendingFocus();
    }

    /* Reconciles the stored cart against live server data, then draws it.
       Prices and totals come only from the server response.
       `initialInvalidCount` preserves the invalid-entry notice from the first
       read, which would otherwise be lost to the count refresh. */
    function renderCart(announcement, initialInvalidCount) {
        var status = statusElement();
        if (!status || !listElement) return;

        fetch("/api/products", { headers: { accept: "application/json" } })
            .then(function (response) {
                if (!response.ok) throw new Error("Server returned " + response.status + ".");
                return response.json();
            })
            .then(function (data) {
                var products = (data && data.products) || [];
                var bySlug = Object.create(null);
                products.forEach(function (product) {
                    bySlug[product.slug] = product;
                });

                var stored = read();
                var kept = [];
                var unavailable = 0;

                stored.items.forEach(function (item) {
                    var product = bySlug[item.slug];
                    if (!product) {
                        unavailable += 1;
                        return;
                    }
                    kept.push({ product: product, quantity: item.quantity });
                });
                lastRows = kept;

                if (unavailable > 0) {
                    write(
                        kept.map(function (row) {
                            return { slug: row.product.slug, quantity: row.quantity };
                        })
                    );
                    refreshCount();
                }

                status.classList.remove("error");
                var invalidCount =
                    initialInvalidCount === undefined ? stored.invalidCount : initialInvalidCount;
                status.textContent = [drawNotices(invalidCount, unavailable), announcement]
                    .filter(Boolean)
                    .join(" ");
                drawItems(kept);
            })
            .catch(function (error) {
                status.classList.add("error");
                status.textContent = "Your cart could not be loaded. " + error.message;
            });
    }

    function onCartClick(event) {
        var button = event.target.closest ? event.target.closest("[data-action]") : null;
        if (!button || !listElement.contains(button) || button.disabled) return;

        var slug = button.getAttribute("data-slug");
        var action = button.getAttribute("data-action");
        var current = null;
        read().items.forEach(function (item) {
            if (item.slug === slug) current = item;
        });
        if (!current) return;

        var message = "";
        if (action === "inc") {
            setQuantity(slug, current.quantity + 1);
            message = "Quantity updated to " + Math.min(current.quantity + 1, MAX_QTY) + ".";
        } else if (action === "dec") {
            var next = Math.max(current.quantity - 1, 1);
            setQuantity(slug, next);
            message = "Quantity updated to " + next + ".";
        } else if (action === "remove") {
            remove(slug);
            message = "Item removed.";
        } else {
            return;
        }

        pendingFocus = { action: action, slug: slug };
        renderCart(message);
    }

    function nameFor(slug) {
        for (var i = 0; i < lastRows.length; i += 1) {
            if (lastRows[i].product.slug === slug) return lastRows[i].product.name;
        }
        return slug;
    }

    /* Sends slugs and quantities only - never a price. The server resolves
       everything again and answers with a redirect URL or a structured error. */
    function onCheckoutClick() {
        var button = document.getElementById("cart-checkout");
        var status = document.getElementById("checkout-status");
        if (!button || !status || button.disabled) return;

        var items = read().items;
        if (items.length === 0) {
            status.classList.add("error");
            status.textContent = "Your cart is empty.";
            return;
        }

        var finish = function (message, isError) {
            button.disabled = false;
            checkoutRequestId = uuid4();
            status.classList.toggle("error", Boolean(isError));
            status.textContent = message;
        };

        button.disabled = true;
        status.classList.remove("error");
        status.textContent = "Starting checkout…";

        fetch("/api/checkout", {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ items: items, request_id: checkoutRequestId })
        })
            .then(function (response) {
                return response
                    .json()
                    .catch(function () {
                        return {};
                    })
                    .then(function (data) {
                        return { ok: response.ok, status: response.status, data: data };
                    });
            })
            .then(function (result) {
                var data = result.data || {};

                if (result.ok && typeof data.url === "string") {
                    status.textContent = "Taking you to the secure payment page…";
                    window.location.assign(data.url);
                    return;
                }

                if (result.status === 409 && data.error === "insufficient_stock") {
                    var notes = [];
                    (data.items || []).forEach(function (shortage) {
                        if (shortage.available < 1) {
                            remove(shortage.slug);
                            notes.push("\u201c" + nameFor(shortage.slug) + "\u201d is out of stock and was removed");
                        } else {
                            setQuantity(shortage.slug, shortage.available);
                            notes.push(
                                "\u201c" + nameFor(shortage.slug) + "\u201d reduced to " +
                                shortage.available + ", which is all that is available"
                            );
                        }
                    });
                    button.disabled = false;
                    status.textContent = "";
                    renderCart(notes.join("; ") + ".");
                    return;
                }

                if (result.status === 409 && data.error === "unavailable") {
                    var gone = (data.items || []).map(function (item) {
                        return item.slug;
                    });
                    var remaining = read().items.filter(function (item) {
                        return gone.indexOf(item.slug) === -1;
                    });
                    write(remaining);
                    refreshCount();
                    button.disabled = false;
                    status.textContent = "";
                    renderCart("Some items were removed because they are no longer available.");
                    return;
                }

                finish(
                    data.message || "Checkout could not be started. Please try again.",
                    true
                );
            })
            .catch(function () {
                finish("Checkout could not be started. Check your connection and try again.", true);
            });
    }

    function init() {
        if (document.body.getAttribute("data-page") !== "cart") {
            refreshCount();
            return;
        }

        listElement = document.getElementById("cart-items");
        if (listElement) {
            listElement.addEventListener("click", onCartClick);
        }

        var checkoutButton = document.getElementById("cart-checkout");
        if (checkoutButton) {
            checkoutButton.addEventListener("click", onCheckoutClick);
        }

        /* Read once before the count refresh, otherwise the invalid-entry
           notice is consumed and never shown. */
        var firstRead = read();
        refreshCount();
        renderCart(undefined, firstRead.invalidCount);
    }

    window.StoreCart = {
        KEY: KEY,
        MAX_QTY: MAX_QTY,
        read: read,
        write: write,
        add: add,
        setQuantity: setQuantity,
        remove: remove,
        clear: clear,
        count: count,
        refreshCount: refreshCount
    };

    document.addEventListener("DOMContentLoaded", init);
})();
