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

        var media = el("div", "product-card__media");
        media.setAttribute("aria-hidden", "true");
        media.appendChild(el("span", "product-card__media-label", TYPE_LABELS[product.type] || product.type));
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
        footer.appendChild(buildBadge(product));
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
                    status.textContent = "No products are available yet.";
                    return;
                }
                var fragment = document.createDocumentFragment();
                products.forEach(function (product) {
                    fragment.appendChild(buildCard(product));
                });
                grid.appendChild(fragment);
                status.textContent = products.length + (products.length === 1 ? " product." : " products.");
            })
            .catch(function (error) {
                status.classList.add("error");
                status.textContent = "Products could not be loaded. " + error.message;
            })
            .finally(function () {
                grid.setAttribute("aria-busy", "false");
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

                var badgeWrap = document.getElementById("detail-badge");
                badgeWrap.textContent = "";
                badgeWrap.appendChild(buildBadge(product));

                document.getElementById("detail-meta").textContent =
                    "Product type: " + (TYPE_LABELS[product.type] || product.type) +
                    " · Item code: " + product.slug;

                document.title = product.name + " — Demo Store";
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
