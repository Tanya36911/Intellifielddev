\restrict dbmate

-- Dumped from database version 18.4 (Debian 18.4-1.pgdg13+1)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    node_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    action text NOT NULL,
    target text,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    parent_id uuid,
    level_order integer NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    path text DEFAULT ''::text NOT NULL,
    chain text,
    address text,
    lat double precision,
    lng double precision,
    tz text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_level_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_level_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    level_order integer NOT NULL,
    name text NOT NULL,
    locked boolean DEFAULT false NOT NULL
);


--
-- Name: pay_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pay_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    cutoff_at timestamp with time zone,
    timezone_basis text,
    grace_hours integer DEFAULT 0 NOT NULL,
    lock_behavior text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    sealed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pay_periods_check CHECK ((end_date >= start_date)),
    CONSTRAINT pay_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'sealed'::text])))
);


--
-- Name: response_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.response_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    response_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    store_node_id uuid NOT NULL,
    store_path text NOT NULL,
    survey_version_id uuid NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    question_id text NOT NULL,
    sku_id uuid,
    value jsonb NOT NULL
);


--
-- Name: responses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    survey_version_id uuid NOT NULL,
    store_node_id uuid NOT NULL,
    store_path text NOT NULL,
    user_id uuid NOT NULL,
    online boolean DEFAULT true NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying NOT NULL
);


--
-- Name: skus; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skus (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    line text NOT NULL,
    variant text NOT NULL,
    upc text NOT NULL,
    color text,
    status text DEFAULT 'active'::text NOT NULL,
    reference_images jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT skus_status_check CHECK ((status = ANY (ARRAY['active'::text, 'discontinued'::text])))
);


--
-- Name: survey_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    survey_version_id uuid NOT NULL,
    target_node_id uuid NOT NULL,
    deadline timestamp with time zone,
    timezone_basis text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: survey_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.survey_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    survey_id uuid NOT NULL,
    version_number integer NOT NULL,
    questions jsonb DEFAULT '[]'::jsonb NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: surveys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.surveys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    type text,
    status text DEFAULT 'draft'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT surveys_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'archived'::text])))
);


--
-- Name: tenants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tenants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    payroll_enabled boolean DEFAULT false NOT NULL
);


--
-- Name: time_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.time_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    period_id uuid NOT NULL,
    user_id uuid NOT NULL,
    store_min integer DEFAULT 0 NOT NULL,
    reset_min integer DEFAULT 0 NOT NULL,
    drive_min integer DEFAULT 0 NOT NULL,
    miles numeric DEFAULT 0 NOT NULL,
    mgr_status text DEFAULT 'pending'::text NOT NULL,
    sealed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT time_entries_mgr_status_check CHECK ((mgr_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    email text NOT NULL,
    name text NOT NULL,
    role text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT users_role_check CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'rep'::text])))
);


--
-- Name: assignments assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);


--
-- Name: assignments assignments_tenant_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_tenant_id_user_id_key UNIQUE (tenant_id, user_id);


--
-- Name: audit audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_pkey PRIMARY KEY (id);


--
-- Name: nodes nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_pkey PRIMARY KEY (id);


--
-- Name: nodes nodes_tenant_id_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_tenant_id_code_key UNIQUE (tenant_id, code);


--
-- Name: org_level_definitions org_level_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_level_definitions
    ADD CONSTRAINT org_level_definitions_pkey PRIMARY KEY (id);


--
-- Name: org_level_definitions org_level_definitions_tenant_id_level_order_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_level_definitions
    ADD CONSTRAINT org_level_definitions_tenant_id_level_order_key UNIQUE (tenant_id, level_order);


--
-- Name: pay_periods pay_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_periods
    ADD CONSTRAINT pay_periods_pkey PRIMARY KEY (id);


--
-- Name: response_items response_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_items
    ADD CONSTRAINT response_items_pkey PRIMARY KEY (id);


--
-- Name: responses responses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: skus skus_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_pkey PRIMARY KEY (id);


--
-- Name: skus skus_tenant_id_upc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_tenant_id_upc_key UNIQUE (tenant_id, upc);


--
-- Name: survey_assignments survey_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_assignments
    ADD CONSTRAINT survey_assignments_pkey PRIMARY KEY (id);


--
-- Name: survey_versions survey_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_versions
    ADD CONSTRAINT survey_versions_pkey PRIMARY KEY (id);


--
-- Name: survey_versions survey_versions_survey_id_version_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_versions
    ADD CONSTRAINT survey_versions_survey_id_version_number_key UNIQUE (survey_id, version_number);


--
-- Name: surveys surveys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_pkey PRIMARY KEY (id);


--
-- Name: tenants tenants_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_code_key UNIQUE (code);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: time_entries time_entries_period_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_period_id_user_id_key UNIQUE (period_id, user_id);


--
-- Name: time_entries time_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_tenant_id_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_email_key UNIQUE (tenant_id, email);


--
-- Name: audit_tenant_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_tenant_at_idx ON public.audit USING btree (tenant_id, at);


--
-- Name: nodes_path_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nodes_path_idx ON public.nodes USING btree (path text_pattern_ops);


--
-- Name: nodes_tenant_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nodes_tenant_parent_idx ON public.nodes USING btree (tenant_id, parent_id);


--
-- Name: pay_periods_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pay_periods_tenant_idx ON public.pay_periods USING btree (tenant_id);


--
-- Name: response_items_question_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX response_items_question_idx ON public.response_items USING btree (tenant_id, question_id);


--
-- Name: response_items_response_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX response_items_response_idx ON public.response_items USING btree (response_id);


--
-- Name: response_items_sku_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX response_items_sku_time_idx ON public.response_items USING btree (tenant_id, sku_id, submitted_at);


--
-- Name: response_items_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX response_items_store_idx ON public.response_items USING btree (tenant_id, store_node_id);


--
-- Name: responses_store_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX responses_store_idx ON public.responses USING btree (store_node_id);


--
-- Name: responses_submitted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX responses_submitted_idx ON public.responses USING btree (submitted_at);


--
-- Name: responses_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX responses_tenant_idx ON public.responses USING btree (tenant_id);


--
-- Name: responses_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX responses_version_idx ON public.responses USING btree (survey_version_id);


--
-- Name: skus_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skus_tenant_idx ON public.skus USING btree (tenant_id);


--
-- Name: survey_assignments_node_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_assignments_node_idx ON public.survey_assignments USING btree (target_node_id);


--
-- Name: survey_assignments_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_assignments_tenant_idx ON public.survey_assignments USING btree (tenant_id);


--
-- Name: survey_assignments_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_assignments_version_idx ON public.survey_assignments USING btree (survey_version_id);


--
-- Name: survey_versions_survey_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX survey_versions_survey_idx ON public.survey_versions USING btree (survey_id);


--
-- Name: surveys_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX surveys_tenant_idx ON public.surveys USING btree (tenant_id);


--
-- Name: time_entries_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_entries_period_idx ON public.time_entries USING btree (period_id);


--
-- Name: time_entries_tenant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_entries_tenant_idx ON public.time_entries USING btree (tenant_id);


--
-- Name: time_entries_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX time_entries_user_idx ON public.time_entries USING btree (user_id);


--
-- Name: assignments assignments_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.nodes(id);


--
-- Name: assignments assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: assignments assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assignments
    ADD CONSTRAINT assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: audit audit_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: audit audit_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit
    ADD CONSTRAINT audit_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: nodes nodes_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.nodes(id);


--
-- Name: nodes nodes_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nodes
    ADD CONSTRAINT nodes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: org_level_definitions org_level_definitions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_level_definitions
    ADD CONSTRAINT org_level_definitions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: pay_periods pay_periods_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pay_periods
    ADD CONSTRAINT pay_periods_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: response_items response_items_response_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_items
    ADD CONSTRAINT response_items_response_id_fkey FOREIGN KEY (response_id) REFERENCES public.responses(id) ON DELETE CASCADE;


--
-- Name: response_items response_items_sku_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_items
    ADD CONSTRAINT response_items_sku_id_fkey FOREIGN KEY (sku_id) REFERENCES public.skus(id);


--
-- Name: response_items response_items_store_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_items
    ADD CONSTRAINT response_items_store_node_id_fkey FOREIGN KEY (store_node_id) REFERENCES public.nodes(id);


--
-- Name: response_items response_items_survey_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_items
    ADD CONSTRAINT response_items_survey_version_id_fkey FOREIGN KEY (survey_version_id) REFERENCES public.survey_versions(id);


--
-- Name: response_items response_items_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.response_items
    ADD CONSTRAINT response_items_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: responses responses_store_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_store_node_id_fkey FOREIGN KEY (store_node_id) REFERENCES public.nodes(id);


--
-- Name: responses responses_survey_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_survey_version_id_fkey FOREIGN KEY (survey_version_id) REFERENCES public.survey_versions(id);


--
-- Name: responses responses_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: responses responses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.responses
    ADD CONSTRAINT responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: skus skus_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skus
    ADD CONSTRAINT skus_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: survey_assignments survey_assignments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_assignments
    ADD CONSTRAINT survey_assignments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: survey_assignments survey_assignments_survey_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_assignments
    ADD CONSTRAINT survey_assignments_survey_version_id_fkey FOREIGN KEY (survey_version_id) REFERENCES public.survey_versions(id);


--
-- Name: survey_assignments survey_assignments_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_assignments
    ADD CONSTRAINT survey_assignments_target_node_id_fkey FOREIGN KEY (target_node_id) REFERENCES public.nodes(id);


--
-- Name: survey_assignments survey_assignments_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_assignments
    ADD CONSTRAINT survey_assignments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: survey_versions survey_versions_survey_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.survey_versions
    ADD CONSTRAINT survey_versions_survey_id_fkey FOREIGN KEY (survey_id) REFERENCES public.surveys(id);


--
-- Name: surveys surveys_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.surveys
    ADD CONSTRAINT surveys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: time_entries time_entries_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_period_id_fkey FOREIGN KEY (period_id) REFERENCES public.pay_periods(id);


--
-- Name: time_entries time_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- Name: time_entries time_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.time_entries
    ADD CONSTRAINT time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);


--
-- PostgreSQL database dump complete
--

\unrestrict dbmate


--
-- Dbmate schema migrations
--

INSERT INTO public.schema_migrations (version) VALUES
    ('20260613000001'),
    ('20260615000001'),
    ('20260615000002'),
    ('20260616000001'),
    ('20260616000002'),
    ('20260617000001');
