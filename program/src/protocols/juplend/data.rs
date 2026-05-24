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
    pub amount: u64,
    pub indices: [u8; 3],
}

impl TryFrom<&[u8]> for JupiterOperateData {
    type Error = ProgramError;

    fn try_from(data: &[u8]) -> Result<Self, Self::Error> {
        if data.len() < 11 {
            return Err(ProgramError::InvalidInstructionData);
        }

        Ok(Self {
            amount: u64::from_le_bytes(data[0..8].try_into().unwrap()),
            indices: data[8..11].try_into().unwrap(),
        })
    }
}
