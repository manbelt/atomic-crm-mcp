-- Deal Journey Legs Table Migration
-- Stores journey segments for transportation deals

-- Create deal_journey_legs table
CREATE TABLE IF NOT EXISTS deal_journey_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  leg_order INT NOT NULL DEFAULT 1,
  leg_type TEXT NOT NULL,
  pickup_datetime TIMESTAMPTZ NOT NULL,
  pickup_timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  pickup_location_text TEXT NOT NULL,
  dropoff_location_text TEXT,
  transport_mode TEXT NOT NULL DEFAULT 'none' CHECK (transport_mode IN ('flight', 'train', 'none')),
  carrier_or_operator TEXT,
  transport_number TEXT,
  origin_code TEXT,
  destination_code TEXT,
  terminal TEXT,
  gate TEXT,
  platform TEXT,
  meet_point_instructions TEXT,
  driver_notes TEXT,
  dispatch_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_deal_journey_legs_deal_id ON deal_journey_legs(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_journey_legs_deal_id_leg_order ON deal_journey_legs(deal_id, leg_order);

-- Add constraint to validate leg_type values
ALTER TABLE deal_journey_legs ADD CONSTRAINT IF NOT EXISTS chk_leg_type 
  CHECK (leg_type IN ('airport_arrival', 'airport_departure', 'train_arrival', 'train_departure', 'point_to_point', 'hourly', 'tour_stop'));

-- Create trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_deal_journey_legs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_journey_legs_updated_at ON deal_journey_legs;
CREATE TRIGGER trg_deal_journey_legs_updated_at
  BEFORE UPDATE ON deal_journey_legs
  FOR EACH ROW
  EXECUTE FUNCTION update_deal_journey_legs_updated_at();

-- Enable Row Level Security
ALTER TABLE deal_journey_legs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY deal_journey_legs_select_policy ON deal_journey_legs
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM deals d
    JOIN sales s ON d.sales_id = s.id
    WHERE d.id = deal_journey_legs.deal_id
    AND s.user_id = auth.uid()
  ));

CREATE POLICY deal_journey_legs_insert_policy ON deal_journey_legs
  FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM deals d
    JOIN sales s ON d.sales_id = s.id
    WHERE d.id = deal_journey_legs.deal_id
    AND s.user_id = auth.uid()
  ));

CREATE POLICY deal_journey_legs_update_policy ON deal_journey_legs
  FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM deals d
    JOIN sales s ON d.sales_id = s.id
    WHERE d.id = deal_journey_legs.deal_id
    AND s.user_id = auth.uid()
  ));

CREATE POLICY deal_journey_legs_delete_policy ON deal_journey_legs
  FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM deals d
    JOIN sales s ON d.sales_id = s.id
    WHERE d.id = deal_journey_legs.deal_id
    AND s.user_id = auth.uid()
  ));

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON deal_journey_legs TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;

-- Add comments for documentation
COMMENT ON TABLE deal_journey_legs IS 'Stores journey segments/legs for transportation deals';
COMMENT ON COLUMN deal_journey_legs.deal_id IS 'Reference to the parent deal';
COMMENT ON COLUMN deal_journey_legs.leg_order IS 'Order of the leg within the journey (1, 2, 3, etc.)';
COMMENT ON COLUMN deal_journey_legs.leg_type IS 'Type of journey leg: airport_arrival, airport_departure, train_arrival, train_departure, point_to_point, hourly, tour_stop';
COMMENT ON COLUMN deal_journey_legs.pickup_datetime IS 'Scheduled pickup date and time';
COMMENT ON COLUMN deal_journey_legs.transport_mode IS 'Mode of transport: flight, train, none';
