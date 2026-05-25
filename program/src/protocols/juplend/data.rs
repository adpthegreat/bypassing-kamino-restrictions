use pinocchio::program_error::ProgramError;

pub struct JupiterInitData {
    pub vault_id: u16,
    pub next_position_id: u32,
}

impl TryFrom<&[u8]> for JupiterInitData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < 6 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            vault_id: u16::from_le_bytes(data[0..2].try_into().unwrap()),
            next_position_id: u32::from_le_bytes(data[2..6].try_into().unwrap()),
        })
    }
}

pub struct JupiterOperateData {
    pub collateral_amount: u64,
    pub debt_amount: u64,
    pub indices: [u8; 3],
}

impl TryFrom<&[u8]> for JupiterOperateData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < 19 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            collateral_amount: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            debt_amount: u64::from_le_bytes(data[8..16].try_into().unwrap()),
            indices: data[16..19].try_into().unwrap(),
        })
    }
}
