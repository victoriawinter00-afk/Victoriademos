/* Storefront rendering. Fetches the local product API and builds DOM nodes.
   All catalogue text is written with textContent — never innerHTML — so product
   content cannot inject markup. No third-party code, no external requests. */
(function () {
    "use strict";

    var TYPE_LABELS = { physical: "Physical", digital: "Digital", service: "Service" };

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

    function availabilityLabel(product) {
        if (product.type !== "physical") {
            return TYPE_LABELS[product.type] || product.type;
        }
        return product.in_stock ? "In stock" : "Out of stock";
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = text;
        return node;
    }

    function buildBadge(product) {
        var outOfStock = product.type === "physical" && !product.in_stock;
        return el("span", outOfStock ? "badge badge--out" : "badge", availabilityLabel(product));
    }

    function buildCard(product) {
        var item = el("li", "product-card");
        item.setAttribute("data-type", product.type);

        var media = el("div", "product-card__media");
        if (product.image_key) {
            var image = el("img", "product-card__image");
            image.src = "/images/" + product.image_key;
            image.alt = product.name;
            image.loading = "lazy";
            image.decoding = "async";
            media.appendChild(image);
        } else {
            // No image: the block is decorative, so keep it out of the a11y tree.
            media.setAttribute("aria-hidden", "true");
        }
        var mediaLabel = el(
            "span",
            "product-card__media-label",
            TYPE_LABELS[product.type] || product.type
        );
        mediaLabel.setAttribute("aria-hidden", "true");
        media.appendChild(mediaLabel);
        item.appendChild(media);

        var body = el("div", "product-card__body");
        if (product.category) {
            body.appendChild(el("p", "product-card__category", product.category));
        }

        var heading = el("h3", "product-card__name");
        var link = el("a", null, product.name);
        link.href = "/product/" + encodeURIComponent(product.slug);
        heading.appendChild(link);
        body.appendChild(heading);

        body.appendChild(el("p", "product-card__description", product.description));

        var footer = el("div", "product-card__footer");
        footer.appendChild(el("span", "price", formatPrice(product.price_cents, product.currency)));

        /* The add control sits immediately beside the availability badge and is
           styled the same, so the pair reads as one line of actions. */
        var actions = el("div", "product-card__actions");
        actions.appendChild(buildBadge(product));

        var addButton = el("button", "badge badge-action", "Add to cart");
        addButton.type = "button";
        addButton.setAttribute("data-card-add", product.slug);
        addButton.setAttribute("aria-label", "Add " + product.name + " to cart");
        if (product.type === "physical" && !product.in_stock) {
            addButton.disabled = true;
            addButton.setAttribute("aria-disabled", "true");
            addButton.title = "Out of stock";
        }
        actions.appendChild(addButton);
        footer.appendChild(actions);
        body.appendChild(footer);

        item.appendChild(body);
        return item;
    }

    function listSlugFromPath() {
        var match = window.location.pathname.match(/\/product\/([^/]+)\/?$/);
        if (!match) return "";
        try {
            return decodeURIComponent(match[1]);
        } catch (err) {
            return "";
        }
    }

    /* ---- Catalog filters -------------------------------------------------
       The selected set IS the state, and an EMPTY set means "All Products".
       Mutual exclusion therefore holds by construction rather than by
       bookkeeping: All is pressed exactly when the set is empty, so selecting
       the first type necessarily unpresses it, and pressing All clears it. */
    var selectedTypes = new Set();

    function setCatalogCount(text) {
        var count = document.getElementById("catalog-count");
        if (count) count.textContent = text;
    }

    /* `announce` is true only for a user-initiated change. On first render it is
       false, so the live region stays empty and a screen reader is not
       interrupted the moment the page opens. */
    function applyFilterState(announce) {
        var grid = document.getElementById("product-list");
        if (!grid) return;

        var shown = 0;
        Array.prototype.forEach.call(grid.querySelectorAll(".product-card"), function (card) {
            var visible =
                selectedTypes.size === 0 || selectedTypes.has(card.getAttribute("data-type"));
            card.hidden = !visible;
            if (visible) shown += 1;
        });

        Array.prototype.forEach.call(document.querySelectorAll(".filter-toggle"), function (button) {
            var filter = button.getAttribute("data-filter");
            var pressed =
                filter === "all" ? selectedTypes.size === 0 : selectedTypes.has(filter);
            button.setAttribute("aria-pressed", pressed ? "true" : "false");
        });

        setCatalogCount(shown === 1 ? "1 product" : shown + " products");

        if (announce) {
            var status = document.getElementById("catalog-status");
            if (status) {
                status.textContent =
                    shown === 1 ? "Showing 1 product." : "Showing " + shown + " products.";
            }
        }
    }

    function onFilterClick(event) {
        var button = event.target.closest ? event.target.closest(".filter-toggle") : null;
        if (!button) return;

        var filter = button.getAttribute("data-filter");
        if (filter === "all") {
            selectedTypes.clear();
        } else if (selectedTypes.has(filter)) {
            selectedTypes.delete(filter);
        } else {
            selectedTypes.add(filter);
        }

        /* Unselecting the last specific type reverts to All Products rather than
           leaving an empty grid with no obvious way back. */
        applyFilterState(true);
    }

    /* ---- Add to cart from a card ----------------------------------------- */
    var ADD_CONFIRM_MS = 1200;
    var addTimers = new WeakMap();

    function onCardAddClick(event) {
        var button = event.target.closest ? event.target.closest("[data-card-add]") : null;
        if (!button || button.disabled) return;

        var cart = window.StoreCart;
        var slug = button.getAttribute("data-card-add");
        if (!cart || !slug) return;

        /* The same module the product page uses, so the two cannot disagree. */
        cart.add(slug, 1);

        var pending = addTimers.get(button);
        if (pending) window.clearTimeout(pending);
        button.textContent = "Added \u2713";
        addTimers.set(
            button,
            window.setTimeout(function () {
                button.textContent = "Add to cart";
                addTimers.delete(button);
            }, ADD_CONFIRM_MS)
        );
    }

    function renderList() {
        var grid = document.getElementById("product-list");
        var status = document.getElementById("catalog-status");
        if (!grid || !status) return;

        fetch("/api/products", { headers: { accept: "application/json" } })
            .then(function (response) {
                if (!response.ok) throw new Error("Server returned " + response.status + ".");
                return response.json();
            })
            .then(function (data) {
                var products = (data && data.products) || [];
                grid.textContent = "";
                if (products.length === 0) {
                    setCatalogCount("No products are available yet.");
                    return;
                }
                var fragment = document.createDocumentFragment();
                products.forEach(function (product) {
                    fragment.appendChild(buildCard(product));
                });
                grid.appendChild(fragment);

                grid.addEventListener("click", onCardAddClick);
                var filterGroup = document.querySelector(".catalog-filters");
                if (filterGroup) filterGroup.addEventListener("click", onFilterClick);

                // Silent on load: nothing is announced until the customer acts.
                applyFilterState(false);
            })
            .catch(function (error) {
                status.classList.add("error");
                status.textContent = "Products could not be loaded. " + error.message;
            })
            .finally(function () {
                grid.setAttribute("aria-busy", "false");
            });
    }

    /* Wires the quantity input and Add to cart button once a product is drawn.
       The cart stores slugs and quantities only; the server re-prices and
       re-validates at checkout. */
    function wireAddToCart(product) {
        var input = document.getElementById("detail-qty");
        var button = document.getElementById("detail-add");
        var status = document.getElementById("detail-add-status");
        var cart = window.StoreCart;
        if (!input || !button || !status || !cart) return;

        var soldOut = product.type === "physical" && !product.in_stock;
        input.min = "1";
        input.max = String(cart.MAX_QTY);
        input.value = "1";

        if (soldOut) {
            input.disabled = true;
            button.disabled = true;
            button.textContent = "Out of stock";
            return;
        }

        button.addEventListener("click", function () {
            var requested = parseInt(input.value, 10);
            if (!isFinite(requested) || requested < 1) requested = 1;
            if (requested > cart.MAX_QTY) requested = cart.MAX_QTY;
            input.value = String(requested);

            cart.add(product.slug, requested);
            status.textContent =
                "Added to cart: " + requested + " \u00d7 " + product.name +
                ". Your cart now holds " + cart.count() + " " +
                (cart.count() === 1 ? "item" : "items") + ".";
        });
    }

    function renderDetail() {
        var status = document.getElementById("detail-status");
        var view = document.getElementById("detail-view");
        if (!status || !view) return;

        var slug = listSlugFromPath();
        if (!slug) {
            status.classList.add("error");
            status.textContent = "No product was specified in this address.";
            return;
        }

        fetch("/api/products/" + encodeURIComponent(slug), { headers: { accept: "application/json" } })
            .then(function (response) {
                if (response.status === 404) {
                    throw new Error("not-found");
                }
                if (!response.ok) throw new Error("Server returned " + response.status + ".");
                return response.json();
            })
            .then(function (data) {
                var product = data && data.product;
                if (!product) throw new Error("not-found");

                document.getElementById("detail-name").textContent = product.name;
                document.getElementById("detail-price").textContent =
                    formatPrice(product.price_cents, product.currency);
                document.getElementById("detail-description").textContent = product.description;

                var category = document.getElementById("detail-category");
                if (product.category) {
                    category.textContent = product.category;
                } else {
                    category.hidden = true;
                }

                var mediaLabel = document.getElementById("detail-media-label");
                mediaLabel.textContent = TYPE_LABELS[product.type] || product.type;
                mediaLabel.setAttribute("aria-hidden", "true");

                var mediaBox = document.getElementById("detail-media");
                if (mediaBox) {
                    var previous = mediaBox.querySelector("img");
                    if (previous) previous.remove();
                    if (product.image_key) {
                        mediaBox.removeAttribute("aria-hidden");
                        var detailImage = el("img", "detail-image");
                        detailImage.src = "/images/" + product.image_key;
                        detailImage.alt = product.name;
                        detailImage.decoding = "async";
                        mediaBox.insertBefore(detailImage, mediaLabel);
                    } else {
                        mediaBox.setAttribute("aria-hidden", "true");
                    }
                }

                var badgeWrap = document.getElementById("detail-badge");
                badgeWrap.textContent = "";
                badgeWrap.appendChild(buildBadge(product));

                document.getElementById("detail-meta").textContent =
                    "Product type: " + (TYPE_LABELS[product.type] || product.type) +
                    " · Item code: " + product.slug;

                document.title = product.name + " — Demo Store";
                wireAddToCart(product);
                status.hidden = true;
                view.hidden = false;
            })
            .catch(function (error) {
                status.classList.add("error");
                if (error.message === "not-found") {
                    status.textContent = "That product is not available. It may have been removed or is no longer active.";
                } else {
                    status.textContent = "The product could not be loaded. " + error.message;
                }
            });
    }

    document.addEventListener("DOMContentLoaded", function () {
        var page = document.body.getAttribute("data-page");
        if (page === "list") renderList();
        if (page === "detail") renderDetail();
    });
})();
