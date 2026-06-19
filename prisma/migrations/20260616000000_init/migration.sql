-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension (search: unaccent for transliterated terms, btree_gin to combine FTS + scalar)
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "btree_gin";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('VISITOR', 'USER', 'CREATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "IconStatus" AS ENUM ('DRAFT', 'PROCESSING', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('FREE', 'PREMIUM');

-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('FREE_ATTRIBUTION', 'PREMIUM_STANDARD', 'PREMIUM_EXTENDED');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "CreatorAppStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('APPROVE', 'REJECT', 'REQUEST_CHANGES');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "google_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creators" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "bio" TEXT,
    "website" TEXT,
    "country" TEXT,
    "revenue_share_bps" INTEGER NOT NULL DEFAULT 7000,
    "stripe_account_id" TEXT,
    "total_downloads" INTEGER NOT NULL DEFAULT 0,
    "total_revenue_cents" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_applications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "CreatorAppStatus" NOT NULL DEFAULT 'PENDING',
    "portfolio_url" TEXT,
    "message" TEXT,
    "reviewed_by" UUID,
    "review_note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "creator_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description" TEXT,
    "icon_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" CITEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icons" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description" TEXT,
    "status" "IconStatus" NOT NULL DEFAULT 'DRAFT',
    "price_type" "PriceType" NOT NULL DEFAULT 'FREE',
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "license" "LicenseType" NOT NULL DEFAULT 'FREE_ATTRIBUTION',
    "svg_key" TEXT,
    "svg_raw_key" TEXT,
    "png_key" TEXT,
    "thumb_key" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "file_size" INTEGER,
    "checksum" TEXT,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "favorite_count" INTEGER NOT NULL DEFAULT 0,
    "rejection_reason" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "search_vector" tsvector,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "icons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icon_tags" (
    "icon_id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,

    CONSTRAINT "icon_tags_pkey" PRIMARY KEY ("icon_id","tag_id")
);

-- CreateTable
CREATE TABLE "icon_packs" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description" TEXT,
    "status" "IconStatus" NOT NULL DEFAULT 'DRAFT',
    "price_cents" INTEGER NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "license" "LicenseType" NOT NULL DEFAULT 'FREE_ATTRIBUTION',
    "cover_icon_id" UUID,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "icon_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pack_items" (
    "pack_id" UUID NOT NULL,
    "icon_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pack_items_pkey" PRIMARY KEY ("pack_id","icon_id")
);

-- CreateTable
CREATE TABLE "favorites" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "icon_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_items" (
    "collection_id" UUID NOT NULL,
    "icon_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "added_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_items_pkey" PRIMARY KEY ("collection_id","icon_id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "subtotal_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "stripe_checkout_id" TEXT,
    "stripe_payment_intent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "item_type" TEXT NOT NULL,
    "icon_id" UUID,
    "pack_id" UUID,
    "creator_id" UUID NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "platform_fee_cents" INTEGER NOT NULL,
    "creator_earnings_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" TEXT NOT NULL,
    "stripe_event_id" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_transfer_id" TEXT,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "download_history" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "icon_id" UUID NOT NULL,
    "pack_id" UUID,
    "ip" inet,
    "user_agent" TEXT,
    "was_free" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "download_history_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- download_history is RANGE-partitioned by month (heavy write path; see DATABASE.md).
-- Create monthly partitions for 2025-01 .. 2026-12, plus a DEFAULT catch-all so
-- writes outside the range never fail. Future months are provisioned by ops
-- (runbook in M11); the DEFAULT keeps the system correct until then.
DO $$
DECLARE
  d date := '2025-01-01';
  part_name text;
BEGIN
  WHILE d < '2027-01-01' LOOP
    part_name := 'download_history_' || to_char(d, 'YYYY_MM');
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF "download_history" FOR VALUES FROM (%L) TO (%L);',
      part_name, d, (d + interval '1 month')::date
    );
    d := (d + interval '1 month')::date;
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS "download_history_default" PARTITION OF "download_history" DEFAULT;

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "icon_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "moderation_events" (
    "id" UUID NOT NULL,
    "icon_id" UUID,
    "pack_id" UUID,
    "moderator_id" UUID NOT NULL,
    "action" "ModerationAction" NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "metadata" JSONB,
    "ip" inet,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_id_key" ON "users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "creators_user_id_key" ON "creators"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "creators_slug_key" ON "creators"("slug");

-- CreateIndex
CREATE INDEX "creator_applications_user_id_idx" ON "creator_applications"("user_id");

-- CreateIndex
CREATE INDEX "creator_applications_status_idx" ON "creator_applications"("status");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "icons_status_published_at_idx" ON "icons"("status", "published_at");

-- CreateIndex
CREATE INDEX "icons_category_id_idx" ON "icons"("category_id");

-- CreateIndex
CREATE INDEX "icons_creator_id_idx" ON "icons"("creator_id");

-- CreateIndex
CREATE INDEX "icons_checksum_idx" ON "icons"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "icons_creator_id_slug_key" ON "icons"("creator_id", "slug");

-- CreateIndex
CREATE INDEX "icon_tags_tag_id_idx" ON "icon_tags"("tag_id");

-- CreateIndex
CREATE INDEX "icon_packs_status_published_at_idx" ON "icon_packs"("status", "published_at");

-- CreateIndex
CREATE INDEX "icon_packs_creator_id_idx" ON "icon_packs"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "icon_packs_creator_id_slug_key" ON "icon_packs"("creator_id", "slug");

-- CreateIndex
CREATE INDEX "pack_items_icon_id_idx" ON "pack_items"("icon_id");

-- CreateIndex
CREATE INDEX "favorites_icon_id_idx" ON "favorites"("icon_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorites_user_id_icon_id_key" ON "favorites"("user_id", "icon_id");

-- CreateIndex
CREATE UNIQUE INDEX "collections_user_id_slug_key" ON "collections"("user_id", "slug");

-- CreateIndex
CREATE INDEX "collection_items_icon_id_idx" ON "collection_items"("icon_id");

-- CreateIndex
CREATE INDEX "purchases_user_id_idx" ON "purchases"("user_id");

-- CreateIndex
CREATE INDEX "purchases_status_idx" ON "purchases"("status");

-- CreateIndex
CREATE INDEX "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");

-- CreateIndex
CREATE INDEX "purchase_items_icon_id_idx" ON "purchase_items"("icon_id");

-- CreateIndex
CREATE INDEX "purchase_items_pack_id_idx" ON "purchase_items"("pack_id");

-- CreateIndex
CREATE INDEX "purchase_items_creator_id_idx" ON "purchase_items"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_purchase_id_key" ON "payments"("purchase_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_stripe_event_id_key" ON "payments"("stripe_event_id");

-- CreateIndex
CREATE INDEX "payouts_creator_id_idx" ON "payouts"("creator_id");

-- CreateIndex
CREATE INDEX "download_history_user_id_idx" ON "download_history"("user_id");

-- CreateIndex
CREATE INDEX "download_history_icon_id_idx" ON "download_history"("icon_id");

-- CreateIndex
CREATE INDEX "download_history_created_at_idx" ON "download_history"("created_at");

-- CreateIndex
CREATE INDEX "reviews_icon_id_idx" ON "reviews"("icon_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_user_id_icon_id_key" ON "reviews"("user_id", "icon_id");

-- CreateIndex
CREATE INDEX "moderation_events_icon_id_idx" ON "moderation_events"("icon_id");

-- CreateIndex
CREATE INDEX "moderation_events_pack_id_idx" ON "moderation_events"("pack_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_id_idx" ON "audit_log"("actor_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "creators" ADD CONSTRAINT "creators_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_applications" ADD CONSTRAINT "creator_applications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_applications" ADD CONSTRAINT "creator_applications_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icons" ADD CONSTRAINT "icons_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icons" ADD CONSTRAINT "icons_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icon_tags" ADD CONSTRAINT "icon_tags_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icon_tags" ADD CONSTRAINT "icon_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icon_packs" ADD CONSTRAINT "icon_packs_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "icon_packs" ADD CONSTRAINT "icon_packs_cover_icon_id_fkey" FOREIGN KEY ("cover_icon_id") REFERENCES "icons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_items" ADD CONSTRAINT "pack_items_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "icon_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_items" ADD CONSTRAINT "pack_items_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "icon_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "creators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_history" ADD CONSTRAINT "download_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_history" ADD CONSTRAINT "download_history_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "download_history" ADD CONSTRAINT "download_history_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "icon_packs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_icon_id_fkey" FOREIGN KEY ("icon_id") REFERENCES "icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "icon_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_events" ADD CONSTRAINT "moderation_events_moderator_id_fkey" FOREIGN KEY ("moderator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Full-text search: GIN + trigram indexes and the search_vector trigger.
-- Prisma has no native tsvector type, so icons.search_vector is managed here.
-- See docs/SEARCH.md (the canonical reference; M7 builds queries on this).
-- ---------------------------------------------------------------------------

-- Primary FTS index over the weighted tsvector.
CREATE INDEX IF NOT EXISTS "icons_search_vector_gin" ON "icons" USING gin ("search_vector");

-- Trigram index on name for fuzzy + prefix/autocomplete.
CREATE INDEX IF NOT EXISTS "icons_name_trgm" ON "icons" USING gin ("name" gin_trgm_ops);

-- Partial index: search only ever touches published, non-deleted rows.
CREATE INDEX IF NOT EXISTS "icons_published_search" ON "icons" USING gin ("search_vector")
  WHERE "status" = 'PUBLISHED' AND "deleted_at" IS NULL;

-- Recompute an icon's weighted search_vector from its row + current tags.
-- Single-row subquery (string_agg over zero tags yields one NULL row), so
-- tagless icons still get a name+description vector.
CREATE OR REPLACE FUNCTION icons_build_search_vector(p_icon_id uuid)
RETURNS void LANGUAGE sql AS $$
  UPDATE icons i
  SET search_vector =
        setweight(to_tsvector('simple', unaccent(coalesce(i.name, ''))),        'A') ||
        setweight(to_tsvector('simple', unaccent(coalesce(t.tag_text, ''))),    'B') ||
        setweight(to_tsvector('simple', unaccent(coalesce(i.description, ''))), 'C')
  FROM (
        SELECT string_agg(tg.name, ' ') AS tag_text
        FROM icon_tags it
        JOIN tags tg ON tg.id = it.tag_id
        WHERE it.icon_id = p_icon_id
  ) t
  WHERE i.id = p_icon_id;
$$;

-- Fire on icon name/description change (and insert). The inner UPDATE only
-- touches search_vector, so it does not re-trigger this AFTER UPDATE OF clause.
CREATE OR REPLACE FUNCTION trg_icons_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM icons_build_search_vector(NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER icons_search_vector_upd
  AFTER INSERT OR UPDATE OF name, description ON icons
  FOR EACH ROW EXECUTE FUNCTION trg_icons_search_vector();

-- Fire on tag membership change so the vector stays in sync with icon_tags.
CREATE OR REPLACE FUNCTION trg_icon_tags_search_vector()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM icons_build_search_vector(COALESCE(NEW.icon_id, OLD.icon_id));
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER icon_tags_search_vector_aiud
  AFTER INSERT OR DELETE ON icon_tags
  FOR EACH ROW EXECUTE FUNCTION trg_icon_tags_search_vector();

